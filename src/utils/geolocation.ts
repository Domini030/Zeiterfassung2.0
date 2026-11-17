import { Capacitor } from '@capacitor/core';
import type { LocationSnapshot } from '../types';
import { getBackendServerUrl } from './apiClient';
import { TaktWerkNative } from './taktwerkNative';

export interface AddressSearchSuggestion {
  lat: number;
  lng: number;
  address: string;
  label: string;
  name?: string;
}

function buildOsmApiUrl(path: string): string {
  const base = Capacitor.isNativePlatform() ? getBackendServerUrl() : '';
  return `${base}${path}`;
}

function canUseServerOsmProxy(): boolean {
  if (!Capacitor.isNativePlatform()) return true;
  return Boolean(getBackendServerUrl());
}

function formatOsmAddressParts(
  addr?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  },
  displayName?: string
): string {
  if (addr) {
    const streetPart = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const cityName =
      addr.city || addr.town || addr.village || addr.municipality || '';
    const cityPart = [addr.postcode, cityName].filter(Boolean).join(' ');
    const formatted = [streetPart, cityPart].filter(Boolean).join(', ');
    if (formatted) return formatted;
  }
  if (displayName) {
    return displayName.split(',').slice(0, 3).join(',').trim();
  }
  return '';
}

export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string> {
  if (canUseServerOsmProxy()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(
        buildOsmApiUrl(
          `/api/osm/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(
            String(lng)
          )}`
        ),
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = (await res.json()) as { address?: string };
        if (data.address) return data.address;
      }
    } catch {
      // Fallback to direct Nominatim below
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      String(lat)
    )}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'de',
      },
    });
    if (!res.ok) throw new Error('Geocode error');
    const data = (await res.json()) as {
      display_name?: string;
      address?: {
        road?: string;
        house_number?: string;
        postcode?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
      };
    };
    const formatted = formatOsmAddressParts(data.address, data.display_name);
    if (formatted) return formatted;
  } catch {
    // Fallback to coordinate display when offline
  } finally {
    clearTimeout(timeoutId);
  }
  return `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
}

export async function captureCurrentLocation(): Promise<LocationSnapshot> {
  let lat: number;
  let lng: number;
  let accuracyMeters: number | undefined;

  if (Capacitor.isNativePlatform()) {
    const res = await TaktWerkNative.getCurrentLocation();
    lat = res.lat;
    lng = res.lng;
    accuracyMeters = res.accuracyMeters;
  } else {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Standortermittlung wird von diesem Browser nicht unterstützt.');
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 30000,
      });
    });
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    accuracyMeters = Math.round(pos.coords.accuracy);
  }

  const address = await reverseGeocodeAddress(lat, lng);
  return {
    lat,
    lng,
    address,
    accuracyMeters,
    capturedAt: new Date().toISOString(),
  };
}

export function formatLocationLabel(loc?: LocationSnapshot | null): string {
  if (!loc) return '';
  if (loc.address) return loc.address;
  return `${loc.lat.toFixed(4)}°, ${loc.lng.toFixed(4)}°`;
}

export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export async function searchAddressesOsm(
  query: string,
  limit = 5
): Promise<AddressSearchSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (canUseServerOsmProxy()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        buildOsmApiUrl(
          `/api/osm/search?q=${encodeURIComponent(trimmed)}&limit=${encodeURIComponent(
            String(limit)
          )}`
        ),
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: AddressSearchSuggestion[] };
        if (Array.isArray(data.results)) {
          return data.results;
        }
      }
    } catch {
      // Fallback to direct Nominatim below
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      trimmed
    )}&limit=${limit}&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'de',
      },
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
      name?: string;
      address?: {
        road?: string;
        house_number?: string;
        postcode?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
      };
    }>;
    return list
      .map((hit) => {
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const compact = formatOsmAddressParts(hit.address, hit.display_name) || trimmed;
        return {
          lat,
          lng,
          address: compact,
          label: hit.display_name || compact,
          name: hit.name || undefined,
        } as AddressSearchSuggestion;
      })
      .filter((item): item is AddressSearchSuggestion => item !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function geocodeAddress(
  query: string
): Promise<{ lat: number; lng: number; address: string } | null> {
  const results = await searchAddressesOsm(query, 1);
  const hit = results[0];
  if (!hit) return null;
  return { lat: hit.lat, lng: hit.lng, address: hit.address };
}

export function computeTravelFromBase(
  base: { lat: number; lng: number },
  target: { lat: number; lng: number },
  ratePerKm = 0.3,
  roundTrip = true
): { oneWayKm: number; distanceKm: number; costNet: number } {
  const straightMeters = calculateDistanceMeters(base.lat, base.lng, target.lat, target.lng);
  if (straightMeters < 150) {
    return { oneWayKm: 0, distanceKm: 0, costNet: 0 };
  }
  const roadMeters = straightMeters * 1.25;
  const oneWayKm = Math.round((roadMeters / 1000) * 10) / 10;
  const totalKm = Math.round((roundTrip ? oneWayKm * 2 : oneWayKm) * 10) / 10;
  const costNet = Math.round(totalKm * Math.max(0, ratePerKm) * 100) / 100;
  return {
    oneWayKm,
    distanceKm: totalKm,
    costNet,
  };
}
