import { Capacitor } from '@capacitor/core';
import type { LocationSnapshot } from '../types';
import { TaktWerkNative } from './taktwerkNative';

async function reverseGeocode(lat: number, lng: number): Promise<string> {
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
    const addr = data.address;
    if (addr) {
      const streetPart = [addr.road, addr.house_number].filter(Boolean).join(' ');
      const cityName =
        addr.city || addr.town || addr.village || addr.municipality || '';
      const cityPart = [addr.postcode, cityName].filter(Boolean).join(' ');
      const formatted = [streetPart, cityPart].filter(Boolean).join(', ');
      if (formatted) return formatted;
    }
    if (data.display_name) {
      return data.display_name.split(',').slice(0, 3).join(',').trim();
    }
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

  const address = await reverseGeocode(lat, lng);
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
