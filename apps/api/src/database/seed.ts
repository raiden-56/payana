/**
 * DEMO DATA - development only.   npm run seed
 *
 * Creates fictional partners, vehicles, approved documents, a few completed
 * trips with reviews, sightseeing packages, sample advertisements and one
 * staff account per administrator role, so the product can be explored
 * without onboarding anyone by hand.
 *
 * Every row uses a fixed id and `ON CONFLICT DO NOTHING`, so running the seed
 * again changes nothing except refreshing the demo drivers' positions and the
 * staff credentials. It refuses to run with NODE_ENV=production.
 *
 * All people, businesses, phone numbers and registration numbers here are
 * invented. The phone numbers sit in a block that is not issued to anyone.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import argon2 from 'argon2';
import type { QueryRunner } from 'typeorm';
import { createDataSource } from '../common/db/data-source.js';
import { encrypt } from '../common/crypto.js';

const envFile = resolve(process.cwd(), '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);

/** Stable uuid derived from a name, so re-running the seed addresses the same rows. */
function id(name: string): string {
  const h = createHash('sha256').update(`payana-demo:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// A valid 1x1 PNG used as the placeholder file behind every demo document.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type Freshness = 'live' | 'recent' | 'stale' | 'none';

interface DemoDriver {
  key: string;
  name: string;
  phone: string;
  partnerType: 'owner_driver' | 'fleet_owner' | 'hired_driver';
  bio: string;
  languages: string[];
  years: number;
  areas: string[];
  availability: 'available' | 'busy' | 'offline';
  lat: number;
  lng: number;
  freshness: Freshness;
  status: 'approved' | 'pending' | 'changes_requested';
  plan?: 'plus' | 'pro';
  vehicles: {
    category: string;
    make: string;
    model: string;
    year: number;
    color: string;
    reg: string;
    seats: number;
    luggage: number;
    ac: boolean;
    rates?: [base: number, perKm: number, waiting: number, fullDay: number | null];
    /** Days until the insurance document expires (default 300). */
    insuranceDays?: number;
    featured?: boolean;
  }[];
}

const DRIVERS: DemoDriver[] = [
  { key: 'd01', name: 'Girish Naik', phone: '+919000000101', partnerType: 'owner_driver', bio: 'Auto driver in Gokarna for twelve years. Knows every lane between the bus stand and Kudle.', languages: ['Kannada', 'Hindi', 'English'], years: 12, areas: ['gokarna'], availability: 'available', lat: 14.5451, lng: 74.3196, freshness: 'live', status: 'approved', plan: 'plus',
    vehicles: [{ category: 'auto', make: 'Bajaj', model: 'RE Compact', year: 2021, color: 'Yellow and black', reg: 'KA47A4821', seats: 3, luggage: 1, ac: false, rates: [4000, 1800, 6000, null], featured: true }] },
  { key: 'd02', name: 'Manjunath Gouda', phone: '+919000000102', partnerType: 'owner_driver', bio: 'Beach drops, temple visits and early-morning station runs.', languages: ['Kannada', 'Hindi'], years: 8, areas: ['gokarna'], availability: 'available', lat: 14.5436, lng: 74.3168, freshness: 'live', status: 'approved',
    vehicles: [{ category: 'auto', make: 'Piaggio', model: 'Ape City', year: 2019, color: 'Yellow and black', reg: 'KA47B1164', seats: 3, luggage: 1, ac: false, rates: [4000, 1700, 6000, null] }] },
  { key: 'd03', name: 'Ravi Harikantra', phone: '+919000000103', partnerType: 'owner_driver', bio: 'From Tadadi. Happy to wait at Om Beach while you swim.', languages: ['Kannada', 'Konkani', 'Hindi'], years: 6, areas: ['gokarna'], availability: 'available', lat: 14.5199, lng: 74.3251, freshness: 'recent', status: 'approved',
    vehicles: [{ category: 'auto', make: 'Bajaj', model: 'RE', year: 2018, color: 'Yellow and black', reg: 'KA47A7730', seats: 3, luggage: 1, ac: false }] },
  { key: 'd04', name: 'Suresh Ambiga', phone: '+919000000104', partnerType: 'owner_driver', bio: 'Sedan for station and airport transfers. Clean car, on time.', languages: ['Kannada', 'English', 'Hindi'], years: 10, areas: ['gokarna', 'kumta'], availability: 'available', lat: 14.5462, lng: 74.3214, freshness: 'live', status: 'approved', plan: 'pro',
    vehicles: [{ category: 'sedan', make: 'Maruti Suzuki', model: 'Dzire', year: 2022, color: 'White', reg: 'KA47M2290', seats: 4, luggage: 3, ac: true, rates: [10000, 1800, 12000, 280000], featured: true }] },
  { key: 'd05', name: 'Prakash Shetty', phone: '+919000000105', partnerType: 'owner_driver', bio: 'Outstation specialist: Goa, Hubballi, Mangaluru. Fifteen years on NH 66.', languages: ['Kannada', 'Tulu', 'English', 'Hindi'], years: 15, areas: ['gokarna', 'kumta', 'karwar'], availability: 'available', lat: 14.5405, lng: 74.3189, freshness: 'recent', status: 'approved',
    vehicles: [{ category: 'suv', make: 'Toyota', model: 'Innova Crysta', year: 2021, color: 'Silver', reg: 'KA47N5512', seats: 6, luggage: 4, ac: true, rates: [15000, 2200, 15000, 420000] }] },
  { key: 'd06', name: 'Vinayak Bhat', phone: '+919000000106', partnerType: 'owner_driver', bio: 'Temple circuit guide and driver. Can explain the history as we go.', languages: ['Kannada', 'Sanskrit', 'English', 'Hindi'], years: 9, areas: ['gokarna'], availability: 'busy', lat: 14.5433, lng: 74.3172, freshness: 'live', status: 'approved',
    vehicles: [{ category: 'hatchback', make: 'Maruti Suzuki', model: 'Swift', year: 2020, color: 'Red', reg: 'KA47P3381', seats: 4, luggage: 2, ac: true, rates: [8000, 1600, 10000, 240000] }] },
  { key: 'd07', name: 'Santosh Naik', phone: '+919000000107', partnerType: 'owner_driver', bio: 'Bike taxi for solo travellers. Quick through the Car Street crowd.', languages: ['Kannada', 'Hindi'], years: 3, areas: ['gokarna'], availability: 'available', lat: 14.5321, lng: 74.3166, freshness: 'live', status: 'approved',
    vehicles: [{ category: 'bike', make: 'Honda', model: 'Activa 6G', year: 2023, color: 'Grey', reg: 'KA47H9043', seats: 1, luggage: 0, ac: false, rates: [2500, 900, 3000, null] }] },
  { key: 'd08', name: 'Mahesh Hegde', phone: '+919000000108', partnerType: 'owner_driver', bio: 'Yana, Vibhooti Falls and Mirjan Fort day trips. Twelve seats for groups.', languages: ['Kannada', 'English', 'Hindi'], years: 11, areas: ['gokarna', 'kumta'], availability: 'available', lat: 14.5487, lng: 74.3302, freshness: 'recent', status: 'approved', plan: 'plus',
    vehicles: [{ category: 'tempo_traveller', make: 'Force', model: 'Traveller 3350', year: 2020, color: 'White', reg: 'KA47T6627', seats: 12, luggage: 10, ac: true, rates: [30000, 3000, 25000, 650000] }] },
  { key: 'd09', name: 'Dinesh Patgar', phone: '+919000000109', partnerType: 'owner_driver', bio: 'Based near Sanikatta. Available early mornings for sunrise trips.', languages: ['Kannada', 'Hindi'], years: 5, areas: ['gokarna'], availability: 'offline', lat: 14.5415, lng: 74.3679, freshness: 'stale', status: 'approved',
    vehicles: [{ category: 'auto', make: 'Bajaj', model: 'RE Compact', year: 2020, color: 'Yellow and black', reg: 'KA47A2256', seats: 3, luggage: 1, ac: false }] },
  { key: 'd10', name: 'Ramesh Gunaga', phone: '+919000000110', partnerType: 'owner_driver', bio: 'Family trips with a child seat on request.', languages: ['Kannada', 'English'], years: 7, areas: ['gokarna', 'kumta'], availability: 'available', lat: 14.5522, lng: 74.3243, freshness: 'stale', status: 'approved',
    vehicles: [{ category: 'suv', make: 'Mahindra', model: 'Marazzo', year: 2019, color: 'Blue-grey', reg: 'KA47N8104', seats: 6, luggage: 4, ac: true, insuranceDays: 18 }] },
  { key: 'd11', name: 'Lokesh Moger', phone: '+919000000111', partnerType: 'owner_driver', bio: 'Honnavar and Murudeshwar runs along the coast road.', languages: ['Kannada', 'Konkani', 'Hindi'], years: 6, areas: ['gokarna', 'honnavar', 'murudeshwar'], availability: 'available', lat: 14.5378, lng: 74.3221, freshness: 'live', status: 'approved',
    vehicles: [{ category: 'sedan', make: 'Hyundai', model: 'Aura', year: 2021, color: 'Grey', reg: 'KA47M7715', seats: 4, luggage: 3, ac: true, rates: [10000, 1700, 12000, 270000] }] },
  { key: 'd12', name: 'Anand Kharvi', phone: '+919000000112', partnerType: 'owner_driver', bio: 'Auto from the Kudle side. Late-night pickups until 11.', languages: ['Kannada', 'Hindi', 'English'], years: 4, areas: ['gokarna'], availability: 'available', lat: 14.5309, lng: 74.3181, freshness: 'none', status: 'approved',
    vehicles: [{ category: 'auto', make: 'TVS', model: 'King', year: 2022, color: 'Yellow and black', reg: 'KA47B5508', seats: 3, luggage: 1, ac: false }] },
  { key: 'd13', name: 'Om Beach Travels', phone: '+919000000113', partnerType: 'fleet_owner', bio: 'Small family-run fleet. Two cars with experienced drivers for transfers and tours.', languages: ['Kannada', 'English', 'Hindi'], years: 14, areas: ['gokarna', 'kumta', 'karwar'], availability: 'available', lat: 14.5466, lng: 74.3206, freshness: 'recent', status: 'approved', plan: 'pro',
    vehicles: [
      { category: 'suv', make: 'Maruti Suzuki', model: 'Ertiga', year: 2022, color: 'White', reg: 'KA47N3345', seats: 6, luggage: 3, ac: true, rates: [15000, 2100, 15000, 400000] },
      { category: 'hatchback', make: 'Tata', model: 'Tiago', year: 2021, color: 'Orange', reg: 'KA47P6012', seats: 4, luggage: 2, ac: true, rates: [8000, 1500, 10000, 230000] },
    ] },
  { key: 'd14', name: 'Nagaraj Mukri', phone: '+919000000114', partnerType: 'owner_driver', bio: 'Hatchback for town trips and Kumta market days.', languages: ['Kannada', 'Hindi'], years: 2, areas: ['gokarna', 'kumta'], availability: 'offline', lat: 14.5441, lng: 74.3229, freshness: 'none', status: 'approved',
    vehicles: [{ category: 'hatchback', make: 'Hyundai', model: 'Grand i10', year: 2018, color: 'Silver', reg: 'KA47P1879', seats: 4, luggage: 2, ac: true }] },
  // Waiting in the verification queue, so the admin console has work to show.
  { key: 'd15', name: 'Shridhar Bhandari', phone: '+919000000115', partnerType: 'owner_driver', bio: 'New on Payana. Auto driver from Bankikodla.', languages: ['Kannada', 'Hindi'], years: 4, areas: ['gokarna'], availability: 'offline', lat: 14.56, lng: 74.33, freshness: 'none', status: 'pending',
    vehicles: [{ category: 'auto', make: 'Bajaj', model: 'RE', year: 2022, color: 'Yellow and black', reg: 'KA47A9917', seats: 3, luggage: 1, ac: false }] },
  { key: 'd16', name: 'Kiran Achari', phone: '+919000000116', partnerType: 'owner_driver', bio: 'Sedan owner from Kumta, expanding to Gokarna.', languages: ['Kannada', 'English'], years: 5, areas: ['gokarna', 'kumta'], availability: 'offline', lat: 14.43, lng: 74.41, freshness: 'none', status: 'changes_requested',
    vehicles: [{ category: 'sedan', make: 'Honda', model: 'Amaze', year: 2020, color: 'White', reg: 'KA47M4406', seats: 4, luggage: 3, ac: true }] },
];

const CUSTOMERS = [
  { key: 'c01', name: 'Anita Rao', phone: '+919000000201' },
  { key: 'c02', name: 'Thomas Mathew', phone: '+919000000202' },
  { key: 'c03', name: 'Priya Deshpande', phone: '+919000000203' },
  { key: 'c04', name: 'Arjun Menon', phone: '+919000000204' },
  { key: 'c05', name: 'Sara Fernandes', phone: '+919000000205' },
];

const STAFF = [
  { email: 'super@payana.local', name: 'Demo Super Admin', role: 'super_admin' },
  { email: 'verify@payana.local', name: 'Demo Verification Officer', role: 'verification_officer' },
  { email: 'support@payana.local', name: 'Demo Support Agent', role: 'support_agent' },
  { email: 'finance@payana.local', name: 'Demo Finance Manager', role: 'finance_manager' },
  { email: 'marketing@payana.local', name: 'Demo Marketing Manager', role: 'marketing_manager' },
];

// driver key, customer key, days ago, trip type, pickup, drop, fare (paise), rating, comment, driver reply
const TRIPS: [string, string, number, string, [string, number, number], [string, number, number], number, number, string, string | null][] = [
  ['d01', 'c01', 3, 'immediate', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Kudle Beach', 14.5318, 74.3162], 12000, 5, 'Came in five minutes and helped with the bags. Fair price.', 'Thank you, see you next time in Gokarna!'],
  ['d01', 'c02', 9, 'immediate', ['Mahabaleshwar Temple', 14.5434, 74.3163], ['Om Beach', 14.5192, 74.3243], 20000, 5, 'Friendly and careful on the hill road.', null],
  ['d01', 'c03', 21, 'scheduled', ['Kudle Beach', 14.5318, 74.3162], ['Gokarna Road Railway Station', 14.5611, 74.3872], 35000, 4, 'On time for a 5 am train. Auto was a little noisy but that is an auto.', null],
  ['d02', 'c04', 5, 'immediate', ['Gokarna Main Beach', 14.5445, 74.314], ['Gokarna Bus Stand', 14.5452, 74.3197], 6000, 4, 'Quick ride, no haggling.', null],
  ['d03', 'c05', 12, 'immediate', ['Om Beach', 14.5192, 74.3243], ['Koti Teertha', 14.5403, 74.3192], 18000, 5, 'Waited for us at Om Beach as promised.', 'Happy to wait. Thank you.'],
  ['d04', 'c01', 7, 'outstation', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Goa (Dabolim) Airport', 15.3808, 73.8314], 480000, 5, 'Spotless car and smooth driving all the way to Dabolim.', 'Thank you Anita, safe travels.'],
  ['d04', 'c03', 16, 'scheduled', ['Gokarna Road Railway Station', 14.5611, 74.3872], ['Kudle Beach', 14.5318, 74.3162], 60000, 5, 'Was waiting at the station with a name board.', null],
  ['d04', 'c05', 30, 'scheduled', ['Kudle Beach', 14.5318, 74.3162], ['Kumta Railway Station', 14.419, 74.429], 110000, 4, 'Good trip. Left ten minutes late.', 'Sorry about the delay - the Kudle road was blocked that morning.'],
  ['d05', 'c02', 10, 'outstation', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Hubballi Airport', 15.3617, 75.0849], 520000, 5, 'Long drive made easy. Knew good places to stop.', null],
  ['d05', 'c04', 25, 'sightseeing', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Yana Caves', 14.5897, 74.5664], 380000, 5, 'Yana and Vibhooti in one day, never rushed.', 'It was a pleasure.'],
  ['d06', 'c03', 4, 'sightseeing', ['Mahabaleshwar Temple', 14.5434, 74.3163], ['Koti Teertha', 14.5403, 74.3192], 150000, 5, 'More guide than driver - explained every temple.', 'Thank you, come back for Shivaratri!'],
  ['d06', 'c01', 18, 'scheduled', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Mirjan Fort', 14.4877, 74.4184], 90000, 4, 'Nice car, good conversation.', null],
  ['d07', 'c05', 2, 'immediate', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Kudle Beach', 14.5318, 74.3162], 7000, 5, 'Fastest way to Kudle with a backpack.', null],
  ['d08', 'c02', 14, 'sightseeing', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Vibhooti Falls', 14.556, 74.545], 700000, 5, 'Eleven of us, one vehicle, great day out.', 'Thank you! Groups are always welcome.'],
  ['d08', 'c04', 40, 'outstation', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Murudeshwar Temple', 14.0942, 74.4847], 620000, 4, 'Comfortable, AC worked well. Started a bit late.', null],
  ['d11', 'c01', 6, 'outstation', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Murudeshwar Temple', 14.0942, 74.4847], 320000, 5, 'Knew the coast road and the best view points.', null],
  ['d11', 'c05', 20, 'scheduled', ['Kudle Beach', 14.5318, 74.3162], ['Honnavar Bus Stand', 14.2802, 74.4437], 210000, 4, 'Good driver, fair quote.', null],
  ['d13', 'c03', 8, 'outstation', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Karwar Bus Stand', 14.8128, 74.1297], 260000, 5, 'Booked for my parents - they were looked after very well.', 'Thank you for trusting us.'],
  ['d13', 'c02', 28, 'sightseeing', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Om Beach', 14.5192, 74.3243], 180000, 4, 'Five beaches in a day. Driver was patient with all our photo stops.', null],
  ['d09', 'c04', 35, 'immediate', ['Sanikatta', 14.5417, 74.3683], ['Gokarna Bus Stand', 14.5452, 74.3197], 15000, 4, 'Polite and honest.', null],
  ['d10', 'c05', 45, 'scheduled', ['Gokarna Bus Stand', 14.5452, 74.3197], ['Kumta Bus Stand', 14.4266, 74.412], 140000, 3, 'Fine trip but the AC was weak.', 'Apologies - the AC has since been serviced.'],
];

const PACKAGES: { slug: string; title: string; summary: string; region: string; artwork: string; hours: number; km: number; best: string; highlights: string[]; stops: [string, string, number][]; prices: [string, number][] }[] = [
  { slug: 'five-beaches-trail', title: 'Five Beaches Trail', summary: 'Gokarna Main, Kudle, Om, Half Moon and Paradise in one unhurried day, with time to swim.', region: 'gokarna', artwork: 'beach', hours: 7, km: 28, best: 'October to March, start by 8 am', highlights: ['Sunset at Om Beach', 'Time to swim at Kudle', 'Driver waits at every stop'],
    stops: [['Gokarna Main Beach', 'A walk on the long town beach', 30], ['Kudle Beach', 'Swim and breakfast at a beach cafe', 90], ['Om Beach', 'The Om-shaped twin coves and the view point', 90], ['Half Moon Beach', 'Short trail or boat from Om Beach', 60], ['Paradise Beach', 'The quietest of the five, by trail or boat', 60]],
    prices: [['auto', 120000], ['hatchback', 180000], ['suv', 260000]] },
  { slug: 'temple-circuit', title: 'Gokarna Temple Circuit', summary: 'Mahabaleshwar, Maha Ganapati, Koti Teertha and the old town lanes, at an easy pace.', region: 'gokarna', artwork: 'temple', hours: 3, km: 6, best: 'Early morning, all year', highlights: ['Atmalinga temple', 'Koti Teertha tank', 'Car Street'],
    stops: [['Maha Ganapati Temple', 'Traditionally visited first', 20], ['Mahabaleshwar Temple', 'The Atmalinga shrine', 45], ['Koti Teertha', 'The temple tank and its ghats', 30], ['Car Street', 'Temple chariots and old houses', 30]],
    prices: [['auto', 50000], ['hatchback', 80000]] },
  { slug: 'yana-and-vibhooti-falls', title: 'Yana Caves and Vibhooti Falls', summary: 'Black limestone spires in the forest and a swim under a waterfall in the Western Ghats.', region: 'kumta', artwork: 'waterfall', hours: 8, km: 110, best: 'September to February', highlights: ['Bhairaveshwara and Mohini peaks', 'Forest walk', 'Natural pool at the falls'],
    stops: [['Yana Caves', 'Short forest walk to the rock spires and cave temple', 120], ['Vibhooti Falls', 'Waterfall with a pool to swim in', 90], ['Mirjan Fort', 'Laterite fort on the way back', 45]],
    prices: [['sedan', 320000], ['suv', 400000], ['tempo_traveller', 650000]] },
  { slug: 'murudeshwar-and-honnavar-backwaters', title: 'Murudeshwar and Honnavar Backwaters', summary: 'South along the coast: the sea-side Shiva, the gopura lift and a boat on the Sharavathi.', region: 'honnavar', artwork: 'backwater', hours: 9, km: 160, best: 'October to April', highlights: ['Murudeshwar gopura view', 'Sharavathi boat ride', 'Apsarakonda falls'],
    stops: [['Sharavathi Backwaters', 'Mangrove boat ride at Honnavar', 75], ['Apsarakonda Falls', 'Small falls and a cliff-top sea view', 45], ['Murudeshwar Temple', 'The giant Shiva statue and the gopura', 120]],
    prices: [['sedan', 420000], ['suv', 520000], ['tempo_traveller', 800000]] },
  { slug: 'mirjan-fort-and-kumta', title: 'Mirjan Fort and Kumta Coast', summary: 'A half day at the pepper queen’s laterite fort, then Kumta’s quiet beaches.', region: 'kumta', artwork: 'fort', hours: 5, km: 60, best: 'July to February - the fort is greenest in the monsoon', highlights: ['Mirjan Fort', 'Vannalli Beach', 'Kumta market'],
    stops: [['Mirjan Fort', 'Sixteenth-century laterite fort', 75], ['Vannalli Beach', 'Rocky headland and fishing boats', 45], ['Kumta Bus Stand', 'Town market stop', 30]],
    prices: [['auto', 160000], ['hatchback', 200000], ['suv', 280000]] },
];

const ADS: [string, string, string, string, string, string, string[], string[], number][] = [
  ['ad01', 'Namaste Shoreline Cafe (demo)', 'Breakfast with a sea view', 'Filter coffee, dosa and banana pancakes on Kudle Beach from 7 am.', 'Call the cafe', 'tel:+919000000301', ['home_strip', 'booking_confirmation'], ['gokarna'], 6],
  ['ad02', 'Sahyadri Surf School (demo)', 'First surf lesson in Gokarna', 'Beginner lessons on the main beach. Boards and rash vests included.', 'See lesson times', 'https://example.com/sahyadri-surf', ['home_strip', 'search_inline'], ['gokarna'], 5],
  ['ad03', 'Kadalu Homestay (demo)', 'A quiet room near Om Beach', 'Family-run homestay, home-cooked coastal meals, ten minutes from the beach.', 'Check availability', 'https://example.com/kadalu-homestay', ['search_inline', 'package_detail'], [], 4],
];

const place = (label: string, lat: number, lng: number, regionSlug = 'gokarna') => ({ label, location: { lat, lng }, regionSlug });

async function seed(q: QueryRunner, cfg: { password: string; totp: string; dataKey: Buffer; storageDir: string | null }): Promise<void> {
  const exec = (sql: string, params: unknown[] = []) => q.query(sql, params);

  // --- staff ---------------------------------------------------------------------------
  const passwordHash = await argon2.hash(cfg.password);
  const mfaSecret = encrypt(cfg.totp, cfg.dataKey);
  for (const s of STAFF) {
    await exec(
      `INSERT INTO users (id, email, display_name, roles, admin_role, password_hash, mfa_secret_enc, mfa_enabled)
       VALUES ($1, $2, $3, '{admin}', $4, $5, $6, true)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, mfa_secret_enc = EXCLUDED.mfa_secret_enc, mfa_enabled = true,
             mfa_last_step = NULL, failed_login_count = 0, locked_until = NULL, status = 'active', admin_role = EXCLUDED.admin_role`,
      [id(`staff:${s.email}`), s.email, s.name, s.role, passwordHash, mfaSecret],
    );
  }
  const reviewer = id('staff:verify@payana.local');

  // --- customers -------------------------------------------------------------------------
  for (const c of CUSTOMERS) {
    await exec(`INSERT INTO users (id, phone, display_name, roles) VALUES ($1, $2, $3, '{customer}') ON CONFLICT DO NOTHING`, [
      id(`user:${c.key}`),
      c.phone,
      c.name,
    ]);
  }

  // --- partners, vehicles, documents ---------------------------------------------------------
  const plans = new Map<string, string>(
    ((await exec(`SELECT id, code FROM subscription_plans`)) as { id: string; code: string }[]).map((p) => [p.code, p.id]),
  );
  const planPrice = new Map<string, number>(
    ((await exec(`SELECT code, price_minor FROM subscription_plans`)) as { code: string; price_minor: number }[]).map((p) => [p.code, p.price_minor]),
  );
  const files: string[] = [];
  let invoiceSeq = 0;

  for (const d of DRIVERS) {
    const userId = id(`user:${d.key}`);
    const profileId = id(`profile:${d.key}`);
    const approved = d.status === 'approved';
    await exec(`INSERT INTO users (id, phone, display_name, roles) VALUES ($1, $2, $3, '{customer,driver}') ON CONFLICT DO NOTHING`, [
      userId,
      d.phone,
      d.name,
    ]);
    await exec(
      `INSERT INTO driver_profiles
         (id, user_id, partner_type, display_name, bio, languages, years_experience, service_areas,
          verification_status, listing_status, availability, operating_hours, last_lat, last_lng, submitted_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14, now() - interval '2 days', now() - ($15 || ' days')::interval)
       ON CONFLICT DO NOTHING`,
      [
        profileId, userId, d.partnerType, d.name, d.bio, d.languages, d.years, d.areas, d.status,
        approved ? 'published' : 'unlisted', approved ? d.availability : 'offline',
        JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], from: '06:00', to: '22:00' }),
        d.freshness === 'none' ? null : d.lat, d.freshness === 'none' ? null : d.lng,
        String(60 + d.years * 20),
      ],
    );

    const personDocs = d.partnerType === 'fleet_owner' ? ['identity'] : ['identity', 'driving_licence'];
    const docStatus = (type: string) => (approved ? 'approved' : d.status === 'changes_requested' && type === 'insurance' ? 'rejected' : 'pending');
    const addDoc = async (type: string, vehicleId: string | null, number: string, expiresInDays: number | null) => {
      const docId = id(`doc:${d.key}:${vehicleId ?? 'person'}:${type}`);
      const fileKey = `driver_document/${userId}/${docId}.png`;
      const status = docStatus(type);
      files.push(fileKey);
      await exec(
        `INSERT INTO uploads (file_key, user_id, purpose, content_type, size_bytes, uploaded_at)
         VALUES ($1, $2, 'driver_document', 'image/png', $3, now()) ON CONFLICT DO NOTHING`,
        [fileKey, userId, PLACEHOLDER_PNG.length],
      );
      await exec(
        `INSERT INTO driver_documents
           (id, driver_profile_id, vehicle_id, type, document_number_enc, document_number_tail, expires_on, file_key, content_type,
            status, rejection_reason, reviewer_note, submitted_at, reviewed_at, reviewed_by, reviewed_by_label)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END, $8,'image/png',
                 $9,$10,$11, now() - interval '2 days', $12, $13, $14)
         ON CONFLICT DO NOTHING`,
        [
          docId, profileId, vehicleId, type, encrypt(number, cfg.dataKey), number.slice(-4), expiresInDays, fileKey, status,
          status === 'rejected' ? 'unreadable' : null,
          status === 'rejected' ? 'The policy schedule page is cut off - please upload the full page.' : null,
          status === 'pending' ? null : new Date(Date.now() - 86_400_000),
          status === 'pending' ? null : reviewer,
          status === 'pending' ? null : 'verify@payana.local',
        ],
      );
    };
    const n = d.key.slice(1);
    for (const type of personDocs) {
      await addDoc(type, null, type === 'identity' ? `DEMOID0000${n}` : `KA47202000${n}7${n}`, type === 'identity' ? null : 900);
    }

    for (const [i, v] of d.vehicles.entries()) {
      const vehicleId = id(`vehicle:${d.key}:${i}`);
      await exec(
        `INSERT INTO vehicles
           (id, owner_profile_id, category_code, make, model, year, color, registration_number, seats, luggage_capacity, has_ac,
            base_fare_minor, per_km_minor, per_hour_waiting_minor, full_day_minor, verification_status, listing_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
        [
          vehicleId, profileId, v.category, v.make, v.model, v.year, v.color, v.reg, v.seats, v.luggage, v.ac,
          v.rates?.[0] ?? null, v.rates?.[1] ?? null, v.rates?.[2] ?? null, v.rates?.[3] ?? null,
          d.status, approved ? 'published' : 'unlisted',
        ],
      );
      await addDoc('vehicle_registration', vehicleId, v.reg, null);
      await addDoc('insurance', vehicleId, `POL${n}${i}55310`, v.insuranceDays ?? 300);
      await addDoc('permit', vehicleId, `PRM${n}${i}8842`, 500);
      await addDoc('fitness', vehicleId, `FIT${n}${i}2076`, 400);
      if (i === 0 && approved) await exec(`UPDATE driver_profiles SET active_vehicle_id = $2 WHERE id = $1 AND active_vehicle_id IS NULL`, [profileId, vehicleId]);
      if (v.featured) {
        await exec(
          `INSERT INTO featured_placements (id, driver_profile_id, vehicle_id, region_slug, starts_on, ends_on, status, from_plan_allowance)
           VALUES ($1, $2, $3, 'gokarna', CURRENT_DATE - 1, CURRENT_DATE + 30, 'active', false) ON CONFLICT DO NOTHING`,
          [id(`featured:${d.key}`), profileId, vehicleId],
        );
      }
    }

    await exec(
      `INSERT INTO verification_events (id, driver_profile_id, actor_label, action, note, at)
       VALUES ($1, $2, $3, 'submitted_for_review', NULL, now() - interval '2 days') ON CONFLICT DO NOTHING`,
      [id(`vevent:${d.key}:submit`), profileId, d.name],
    );
    if (d.status !== 'pending') {
      await exec(
        `INSERT INTO verification_events (id, driver_profile_id, actor_label, action, note, at)
         VALUES ($1, $2, 'verify@payana.local', $3, $4, now() - interval '1 day') ON CONFLICT DO NOTHING`,
        [
          id(`vevent:${d.key}:decision`), profileId,
          approved ? 'decision:approve' : 'decision:request_changes',
          approved ? null : 'Insurance copy is unreadable. Please upload the full policy schedule.',
        ],
      );
    }

    if (d.plan) {
      const subId = id(`sub:${d.key}`);
      const invoiceId = id(`invoice:${d.key}`);
      invoiceSeq += 1;
      await exec(
        `INSERT INTO driver_subscriptions (id, driver_profile_id, plan_id, status, current_period_start, current_period_end, quotes_used)
         VALUES ($1, $2, $3, 'active', now() - interval '6 days', now() + interval '24 days', $4) ON CONFLICT DO NOTHING`,
        [subId, profileId, plans.get(d.plan), 7 + invoiceSeq],
      );
      await exec(
        `INSERT INTO invoices (id, number, driver_profile_id, kind, reference_id, description, amount_minor, status, provider, issued_at, paid_at)
         VALUES ($1, $2, $3, 'subscription', $4, $5, $6, 'paid', 'manual', now() - interval '6 days', now() - interval '6 days')
         ON CONFLICT DO NOTHING`,
        [invoiceId, `INV-DEMO-${String(invoiceSeq).padStart(4, '0')}`, profileId, subId, `${d.plan === 'pro' ? 'Pro' : 'Plus'} plan - monthly`, planPrice.get(d.plan)],
      );
    }
  }

  // --- completed trips with reviews -------------------------------------------------------------
  const policy = {
    freeUntilMinutesBefore: 60,
    lateFee: { amountMinor: 0, currency: 'INR' },
    summary: 'Free cancellation up to 60 minutes before pickup. No cancellation fee is charged at present.',
  };
  for (const [i, t] of TRIPS.entries()) {
    const [dk, ck, daysAgo, tripType, pickup, drop, fare, rating, comment, reply] = t;
    const driver = DRIVERS.find((d) => d.key === dk)!;
    const customer = CUSTOMERS.find((c) => c.key === ck)!;
    const requestId = id(`trip:${i}:request`);
    const quoteId = id(`trip:${i}:quote`);
    const bookingId = id(`trip:${i}:booking`);
    const profileId = id(`profile:${dk}`);
    const vehicleId = id(`vehicle:${dk}:0`);
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    const done = new Date(when.getTime() + 90 * 60_000);
    const p = JSON.stringify(place(pickup[0], pickup[1], pickup[2]));
    const dr = JSON.stringify(place(drop[0], drop[1], drop[2]));
    await exec(
      `INSERT INTO ride_requests
         (id, customer_id, status, trip_type, pickup, pickup_lat, pickup_lng, drop_place, region_slug, scheduled_at, category_code,
          passengers, luggage, drivers_notified, created_at, expires_at)
       VALUES ($1,$2,'booked',$3,$4::jsonb,$5,$6,$7::jsonb,'gokarna',$8,$9,2,1,4,$10,$11) ON CONFLICT DO NOTHING`,
      [requestId, id(`user:${ck}`), tripType, p, pickup[1], pickup[2], dr, tripType === 'immediate' ? null : when, driver.vehicles[0]!.category,
        new Date(when.getTime() - 3_600_000), new Date(when.getTime() + 3_600_000)],
    );
    await exec(
      `INSERT INTO quotes (id, request_id, driver_profile_id, vehicle_id, status, fare_minor, inclusions, exclusions, valid_until, created_at)
       VALUES ($1,$2,$3,$4,'accepted',$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [quoteId, requestId, profileId, vehicleId, fare, ['Fuel', 'Driver allowance'], tripType === 'outstation' ? ['Tolls', 'Parking'] : [],
        new Date(when.getTime() + 3_600_000), new Date(when.getTime() - 3_000_000)],
    );
    await exec(
      `INSERT INTO bookings
         (id, code, request_id, quote_id, customer_id, driver_profile_id, vehicle_id, status, trip_type, pickup, drop_place,
          scheduled_at, passengers, luggage, quoted_minor, booking_fee_minor, total_minor, inclusions, exclusions,
          cancellation_policy, review_submitted, started_at, completed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9::jsonb,$10::jsonb,$11,2,1,$12,0,$12,$13,$14,$15::jsonb,true,$16,$17,$18)
       ON CONFLICT DO NOTHING`,
      [bookingId, `PY-D${String(i + 1).padStart(4, '0')}`, requestId, quoteId, id(`user:${ck}`), profileId, vehicleId, tripType, p, dr,
        when, fare, ['Fuel', 'Driver allowance'], tripType === 'outstation' ? ['Tolls', 'Parking'] : [], JSON.stringify(policy),
        when, done, new Date(when.getTime() - 2_400_000)],
    );
    await exec(`UPDATE ride_requests SET booking_id = $2 WHERE id = $1 AND booking_id IS NULL`, [requestId, bookingId]);
    const events: [string, Date, string][] = [
      ['confirmed', new Date(when.getTime() - 2_400_000), 'customer'],
      ['driver_en_route', new Date(when.getTime() - 900_000), 'driver'],
      ['driver_arrived', new Date(when.getTime() - 120_000), 'driver'],
      ['in_progress', when, 'driver'],
      ['completed', done, 'driver'],
    ];
    for (const [status, at, actor] of events) {
      await exec(`INSERT INTO booking_events (id, booking_id, status, at, actor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [
        id(`trip:${i}:event:${status}`), bookingId, status, at, actor,
      ]);
    }
    const parts = customer.name.split(' ');
    await exec(
      `INSERT INTO reviews (id, booking_id, driver_profile_id, customer_id, rating, comment, author_name, trip_type, reply_text, reply_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [id(`trip:${i}:review`), bookingId, profileId, id(`user:${ck}`), rating, comment, `${parts[0]} ${parts[1]![0]}.`, tripType, reply,
        reply ? new Date(done.getTime() + 86_400_000) : null, new Date(done.getTime() + 7_200_000)],
    );
  }
  // Bring the denormalised counters in line with the seeded history.
  await exec(
    `UPDATE driver_profiles dp SET
        rating_count = s.n, rating_average = s.avg,
        completed_trips = GREATEST(dp.completed_trips, s.n * 14 + dp.years_experience * 9),
        accepted_bookings = GREATEST(dp.accepted_bookings, s.n * 15 + dp.years_experience * 9)
       FROM (SELECT driver_profile_id, count(*)::int AS n, round(avg(rating), 1) AS avg FROM reviews WHERE status = 'published' GROUP BY 1) s
      WHERE s.driver_profile_id = dp.id AND dp.id = ANY($1::uuid[])`,
    [DRIVERS.map((d) => id(`profile:${d.key}`))],
  );

  // --- packages and advertisements --------------------------------------------------------------------
  for (const [i, pk] of PACKAGES.entries()) {
    await exec(
      `INSERT INTO tour_packages (id, slug, title, summary, region_slug, artwork, duration_hours, distance_km, stops, highlights, price_from, best_time, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13) ON CONFLICT DO NOTHING`,
      [
        id(`package:${pk.slug}`), pk.slug, pk.title, pk.summary, pk.region, pk.artwork, pk.hours, pk.km,
        JSON.stringify(pk.stops.map(([name, description, durationMinutes]) => ({ name, description, durationMinutes }))),
        pk.highlights,
        JSON.stringify(pk.prices.map(([categoryCode, priceMinor]) => ({ categoryCode, priceMinor }))),
        pk.best, i + 1,
      ],
    );
  }
  for (const [key, advertiser, title, body, cta, url, placements, regions, weight] of ADS) {
    await exec(
      `INSERT INTO ad_campaigns (id, advertiser_name, advertiser_contact, title, body, cta_label, cta_url, placements, region_slugs, starts_on, ends_on, status, weight)
       VALUES ($1,$2,'demo@example.com',$3,$4,$5,$6,$7,$8, CURRENT_DATE - 5, CURRENT_DATE + 90, 'scheduled', $9) ON CONFLICT DO NOTHING`,
      [id(`ad:${key}`), advertiser, title, body, cta, url, placements, regions, weight],
    );
  }

  // --- positions: recorded relative to "now" so the demo shows live, recent and stale drivers ---------
  const ages: Record<Exclude<Freshness, 'none'>, string> = { live: '20 seconds', recent: '6 minutes', stale: '3 hours' };
  for (const d of DRIVERS) {
    if (d.freshness === 'none') continue;
    await exec(`UPDATE driver_profiles SET last_lat = $2, last_lng = $3, location_updated_at = now() - $4::interval WHERE id = $1`, [
      id(`profile:${d.key}`), d.lat, d.lng, ages[d.freshness],
    ]);
  }
  // Read by the development-only heartbeat that keeps these positions from all going stale.
  await exec(
    `INSERT INTO platform_settings (key, value) VALUES ('demo_positions', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(DRIVERS.filter((d) => d.freshness === 'live' || d.freshness === 'recent').map((d) => ({ profileId: id(`profile:${d.key}`), freshness: d.freshness })))],
  );

  if (cfg.storageDir) {
    for (const key of files) {
      const path = join(cfg.storageDir, key);
      if (existsSync(path)) continue;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, PLACEHOLDER_PNG);
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed must never run in production.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const password = process.env.SEED_ADMIN_PASSWORD;
  const totp = process.env.SEED_ADMIN_TOTP_SECRET;
  if (!password || password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be set (at least 12 characters).');
  if (!totp) throw new Error('SEED_ADMIN_TOTP_SECRET must be set (base32).');
  const dataKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY ?? '', 'base64');
  if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  const storageDir =
    (process.env.STORAGE_DRIVER ?? 'local') === 'local' ? resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? '.storage') : null;

  const ds = createDataSource(url, process.env.DATABASE_SSL === 'true');
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await seed(runner, { password, totp, dataKey, storageDir });
    await runner.commitTransaction();
    console.log(`Demo data ready: ${DRIVERS.length} partners, ${CUSTOMERS.length} customers, ${TRIPS.length} reviewed trips, ${PACKAGES.length} packages, ${ADS.length} ads, ${STAFF.length} staff.`);
    console.log(`Staff sign-in: ${STAFF.map((s) => s.email).join(', ')}`);
    console.log('Password: SEED_ADMIN_PASSWORD. Authenticator code: npm run totp');
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
