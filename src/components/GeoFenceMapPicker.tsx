import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Crosshair,
  Loader2,
  MapPin,
  Maximize2,
  Navigation,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, GeoFenceRule, Product } from '../types';
import {
  captureCurrentLocation,
  reverseGeocodeAddress,
  searchAddressesOsm,
  type AddressSearchSuggestion,
} from '../utils/geolocation';

export interface PickedMapLocation {
  lat: number;
  lng: number;
  address: string;
  suggestedName?: string;
}

interface GeoFenceMapPickerProps {
  selectedLat: number | null;
  selectedLng: number | null;
  selectedAddress: string;
  radiusMeters: number;
  rules: GeoFenceRule[];
  customers: Customer[];
  products: Product[];
  focusedRuleId: string | null;
  cameraRequestNonce: number;
  theme: 'light' | 'dark';
  onSelectLocation: (loc: PickedMapLocation) => void;
  onUseRuleAsDraft?: (rule: GeoFenceRule) => void;
  onNotify?: (msg: string, isError?: boolean) => void;
}

const DEFAULT_DE_CENTER: [number, number] = [51.1657, 10.4515];

function zoomForRadius(radiusMeters: number): number {
  if (radiusMeters <= 80) return 17;
  if (radiusMeters <= 200) return 16;
  if (radiusMeters <= 400) return 15;
  if (radiusMeters <= 800) return 14;
  return 13;
}

function createPinIcon(fill: string, stroke: string, size: number): L.DivIcon {
  const height = Math.round(size * 1.28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 28 36" fill="none">
    <path d="M14 1.5C7.1 1.5 1.5 7.1 1.5 14c0 9.2 12.5 20.5 12.5 20.5S26.5 23.2 26.5 14C26.5 7.1 20.9 1.5 14 1.5z" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>
    <circle cx="14" cy="13.5" r="4.8" fill="#ffffff"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: 'tw-osm-pin',
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height + 4],
  });
}

export function GeoFenceMapPicker({
  selectedLat,
  selectedLng,
  selectedAddress,
  radiusMeters,
  rules,
  customers,
  products,
  focusedRuleId,
  cameraRequestNonce,
  onSelectLocation,
  onUseRuleAsDraft,
  onNotify,
}: GeoFenceMapPickerProps) {
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const rulesLayerRef = useRef<L.LayerGroup | null>(null);
  const lastCameraNonceRef = useRef<number>(-1);
  const lastFocusedRuleRef = useRef<string | null>(null);

  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [activeRuleDetailId, setActiveRuleDetailId] = useState<string | null>(null);

  // OpenStreetMap Nominatim live search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AddressSearchSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const selectedPosition = useMemo<{ lat: number; lng: number } | null>(() => {
    if (
      selectedLat !== null &&
      selectedLng !== null &&
      Number.isFinite(selectedLat) &&
      Number.isFinite(selectedLng) &&
      !(selectedLat === 0 && selectedLng === 0)
    ) {
      return { lat: selectedLat, lng: selectedLng };
    }
    return null;
  }, [selectedLat, selectedLng]);

  const customerNames = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of customers) out[c.id] = c.companyName;
    return out;
  }, [customers]);

  const productNames = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of products) out[p.id] = p.name;
    return out;
  }, [products]);

  const onSelectLocationRef = useRef(onSelectLocation);
  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
  }, [onSelectLocation]);

  const radiusRef = useRef(radiusMeters);
  useEffect(() => {
    radiusRef.current = radiusMeters;
  }, [radiusMeters]);

  const pickCoordinates = useCallback(async (lat: number, lng: number, pan = false) => {
    setActiveRuleDetailId(null);
    onSelectLocationRef.current({
      lat,
      lng,
      address: `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`,
    });
    const map = mapRef.current;
    if (pan && map) {
      const targetZoom = Math.max(map.getZoom(), zoomForRadius(radiusRef.current));
      map.setView([lat, lng], targetZoom, { animate: true });
    }
    setResolvingAddress(true);
    try {
      const resolved = await reverseGeocodeAddress(lat, lng);
      onSelectLocationRef.current({
        lat,
        lng,
        address: resolved,
      });
    } finally {
      setResolvingAddress(false);
    }
  }, []);

  // Initialize Leaflet + OpenStreetMap map once
  useEffect(() => {
    const container = mapHostRef.current;
    if (!container || mapRef.current) return;

    const initialCenter: [number, number] = selectedPosition
      ? [selectedPosition.lat, selectedPosition.lng]
      : rules[0]
        ? [rules[0].lat, rules[0].lng]
        : DEFAULT_DE_CENTER;

    const initialZoom = selectedPosition
      ? zoomForRadius(radiusMeters)
      : rules[0]
        ? zoomForRadius(rules[0].radiusMeters)
        : 6;

    const map = L.map(container, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map);

    const rulesGroup = L.layerGroup().addTo(map);
    const draftGroup = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      void pickCoordinates(ev.latlng.lat, ev.latlng.lng, true);
    });

    mapRef.current = map;
    rulesLayerRef.current = rulesGroup;
    draftLayerRef.current = draftGroup;

    // Ensure crisp tile layout on mobile/tab transitions
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    resizeObserver?.observe(container);
    const timerId = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(timerId);
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      rulesLayerRef.current = null;
      draftLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render all saved GeoFenceRule markers & radius circles
  useEffect(() => {
    const group = rulesLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const rule of rules) {
      const circle = L.circle([rule.lat, rule.lng], {
        radius: Math.max(30, rule.radiusMeters),
        color: rule.enabled ? '#059669' : '#64748b',
        opacity: rule.enabled ? 0.85 : 0.55,
        weight: 1.5,
        fillColor: rule.enabled ? '#10b981' : '#94a3b8',
        fillOpacity: rule.enabled ? 0.16 : 0.08,
        interactive: false,
      });
      circle.addTo(group);

      const marker = L.marker([rule.lat, rule.lng], {
        icon: createPinIcon(
          rule.enabled ? '#059669' : '#64748b',
          rule.enabled ? '#065f46' : '#334155',
          26
        ),
        title: `${rule.name} (${rule.radiusMeters} m)`,
      });
      marker.on('click', () => {
        setActiveRuleDetailId(rule.id);
      });
      marker.addTo(group);
    }
  }, [rules]);

  // Render active draft selection marker (draggable) + live radius circle
  useEffect(() => {
    const group = draftLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (!selectedPosition) return;

    const circle = L.circle([selectedPosition.lat, selectedPosition.lng], {
      radius: Math.max(30, radiusMeters),
      color: '#7c3aed',
      opacity: 0.9,
      weight: 2,
      fillColor: '#8b5cf6',
      fillOpacity: 0.22,
      interactive: false,
    });
    circle.addTo(group);

    const marker = L.marker([selectedPosition.lat, selectedPosition.lng], {
      icon: createPinIcon('#7c3aed', '#4c1d95', 32),
      draggable: true,
      title: 'Ausgewählter Ort (zum Verschieben ziehen)',
      zIndexOffset: 500,
    });

    marker.on('drag', (ev: L.LeafletEvent) => {
      const pos = (ev.target as L.Marker).getLatLng();
      circle.setLatLng(pos);
    });

    marker.on('dragend', (ev: L.LeafletEvent) => {
      const pos = (ev.target as L.Marker).getLatLng();
      void pickCoordinates(pos.lat, pos.lng, false);
    });

    marker.addTo(group);
  }, [selectedPosition, radiusMeters, pickCoordinates]);

  // Pan/Zoom when updated from form buttons (Suchen / GPS)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPosition) return;
    if (cameraRequestNonce === lastCameraNonceRef.current) return;
    lastCameraNonceRef.current = cameraRequestNonce;
    map.setView(
      [selectedPosition.lat, selectedPosition.lng],
      zoomForRadius(radiusMeters),
      { animate: true }
    );
  }, [selectedPosition, radiusMeters, cameraRequestNonce]);

  // Pan/Zoom when focusing a saved rule from the list
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedRuleId) return;
    if (
      focusedRuleId === lastFocusedRuleRef.current &&
      cameraRequestNonce === lastCameraNonceRef.current
    ) {
      return;
    }
    const target = rules.find((r) => r.id === focusedRuleId);
    if (!target) return;
    lastFocusedRuleRef.current = focusedRuleId;
    setActiveRuleDetailId(target.id);
    map.setView([target.lat, target.lng], zoomForRadius(target.radiusMeters), {
      animate: true,
    });
  }, [focusedRuleId, rules, cameraRequestNonce]);

  // Debounced OpenStreetMap address autocomplete
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timeoutId = setTimeout(() => {
      void searchAddressesOsm(trimmed, 5)
        .then((list) => {
          if (cancelled) return;
          setSearchResults(list);
          setShowSuggestions(true);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 380);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    if (!showSuggestions) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        searchBoxRef.current &&
        e.target instanceof Node &&
        !searchBoxRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showSuggestions]);

  const handleSelectSuggestion = (item: AddressSearchSuggestion) => {
    setShowSuggestions(false);
    setSearchQuery(item.address);
    setActiveRuleDetailId(null);
    onSelectLocation({
      lat: item.lat,
      lng: item.lng,
      address: item.address,
      suggestedName: item.name,
    });
    mapRef.current?.setView([item.lat, item.lng], zoomForRadius(radiusMeters), {
      animate: true,
    });
    onNotify?.(`Ort auf Karte gewählt: ${item.address}`);
  };

  const handleManualSearchTrigger = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const list = await searchAddressesOsm(q, 5);
      setSearchResults(list);
      if (list.length === 1 && list[0]) {
        handleSelectSuggestion(list[0]);
      } else if (list.length > 1) {
        setShowSuggestions(true);
      } else {
        onNotify?.('Keine passende Adresse in OpenStreetMap gefunden.', true);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleCenterMyLocation = async () => {
    setLocatingGps(true);
    try {
      const loc = await captureCurrentLocation();
      setActiveRuleDetailId(null);
      onSelectLocation({
        lat: loc.lat,
        lng: loc.lng,
        address: loc.address || `${loc.lat.toFixed(5)}°, ${loc.lng.toFixed(5)}°`,
      });
      mapRef.current?.setView([loc.lat, loc.lng], zoomForRadius(radiusMeters), {
        animate: true,
      });
      onNotify?.('Aktuellen GPS-Standort auf der Karte zentriert.');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'GPS-Standort konnte nicht abgerufen werden.',
        true
      );
    } finally {
      setLocatingGps(false);
    }
  };

  const handleFitAllPoints = () => {
    const map = mapRef.current;
    if (!map) return;
    const points: [number, number][] = rules.map((r) => [r.lat, r.lng]);
    if (selectedPosition) {
      points.push([selectedPosition.lat, selectedPosition.lng]);
    }
    if (points.length === 0) {
      map.setView(DEFAULT_DE_CENTER, 6, { animate: true });
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], zoomForRadius(rules[0]?.radiusMeters ?? radiusMeters), {
        animate: true,
      });
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
  };

  const activeRuleDetail = useMemo(
    () => rules.find((r) => r.id === activeRuleDetailId) ?? null,
    [rules, activeRuleDetailId]
  );

  return (
    <div className="space-y-3" data-no-swipe="true">
      {/* OpenStreetMap Search Bar + Map Actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div ref={searchBoxRef} className="relative flex-1 min-w-0">
          <div className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-600 dark:border-[#3b2d5e] dark:bg-[#211936] dark:focus-within:border-violet-500">
            <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => {
                if (searchResults.length > 0) setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleManualSearchTrigger();
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              placeholder="Adresse, Straße, PLZ oder Ort suchen (OpenStreetMap)..."
              className="w-full bg-transparent px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
            {searching ? (
              <Loader2 className="mr-2.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-600 dark:text-violet-400" />
            ) : (
              searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setShowSuggestions(false);
                  }}
                  aria-label="Suche leeren"
                  className="mr-1.5 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => void handleManualSearchTrigger()}
              disabled={searching || !searchQuery.trim()}
              className="mr-1 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-[#2a2045] dark:text-slate-200 dark:hover:bg-[#352857] cursor-pointer shrink-0"
            >
              Suchen
            </button>
          </div>

          {showSuggestions && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-[#3b2d5e] dark:bg-[#171126]">
              {searchResults.map((item, idx) => (
                <button
                  key={`${item.lat}-${item.lng}-${idx}`}
                  type="button"
                  onClick={() => handleSelectSuggestion(item)}
                  className="flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-slate-50 dark:border-[#2e2349] dark:hover:bg-[#241b3a] cursor-pointer"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.address}
                    </div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {item.label}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleCenterMyLocation()}
            disabled={locatingGps}
            title="Aktuellen GPS-Standort auf der Karte wählen"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 dark:hover:bg-[#241b3a] cursor-pointer whitespace-nowrap"
          >
            {locatingGps ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Crosshair className="h-3.5 w-3.5" />
            )}
            <span>Mein Standort</span>
          </button>
          {(rules.length > 0 || selectedPosition) && (
            <button
              type="button"
              onClick={handleFitAllPoints}
              title="Alle gespeicherten Orte auf der Karte einblenden"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#241b3a] cursor-pointer whitespace-nowrap"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Alle Orte</span>
            </button>
          )}
        </div>
      </div>

      {/* Explicit-Height OpenStreetMap Canvas */}
      <div
        data-no-swipe="true"
        className="relative h-[340px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-xs dark:border-[#3b2d5e] dark:bg-[#120d1f] sm:h-[390px]"
      >
        <div ref={mapHostRef} className="tw-osm-map h-full w-full" />

        {/* Resolving Address Pill */}
        {resolvingAddress && (
          <div className="pointer-events-none absolute right-3 top-3 z-[450] inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-md backdrop-blur-sm dark:border-[#3b2d5e] dark:bg-[#171126]/95 dark:text-slate-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400" />
            <span>Adresse wird ermittelt...</span>
          </div>
        )}

        {/* Saved Rule Detail Overlay Card when user clicks a saved pin */}
        {activeRuleDetail && (
          <div className="absolute bottom-3 left-3 right-3 z-[450] max-w-sm rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur-md dark:border-[#3b2d5e] dark:bg-[#171126]/95">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                    {activeRuleDetail.name}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${
                      activeRuleDetail.enabled
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {activeRuleDetail.enabled ? 'Aktiv' : 'Pausiert'}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-200">
                  Aufgabe: <span className="font-semibold">{activeRuleDetail.taskTitle}</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {customerNames[activeRuleDetail.customerId] || 'Kunde'} ·{' '}
                  {productNames[activeRuleDetail.productId] || 'Leistung'}
                </div>
                {activeRuleDetail.address && (
                  <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {activeRuleDetail.address}
                  </div>
                )}
                <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                  Radius: {activeRuleDetail.radiusMeters} m · {activeRuleDetail.lat.toFixed(5)},{' '}
                  {activeRuleDetail.lng.toFixed(5)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveRuleDetailId(null)}
                aria-label="Details schließen"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#241b3a] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {onUseRuleAsDraft && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onUseRuleAsDraft(activeRuleDetail);
                    setActiveRuleDetailId(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 cursor-pointer"
                >
                  Position übernehmen
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status & Legend Bar */}
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs dark:border-[#2e2349] dark:bg-[#171126] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
          <div className="min-w-0">
            {selectedPosition ? (
              <>
                <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                  {selectedAddress || 'Ausgewählter Kartenpunkt'}
                </div>
                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedPosition.lat.toFixed(5)}, {selectedPosition.lng.toFixed(5)} · Zielradius{' '}
                  {radiusMeters} m
                </div>
              </>
            ) : (
              <span className="text-slate-600 dark:text-slate-300">
                Tippe direkt auf die OpenStreetMap-Karte, suche oben eine Adresse oder ziehe den violetten Pin (100 % kostenlos, ohne API-Key).
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
            Auswahl
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            Aktive Regel
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            Pausiert
          </span>
        </div>
      </div>
    </div>
  );
}
