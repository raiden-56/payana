import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data the product cannot run without: regions, curated places,
 * vehicle categories and subscription plans. Safe for every environment,
 * including production. All of it is editable afterwards through the admin
 * API - this migration only provides the launch values and never overwrites
 * a row that already exists.
 *
 * Coordinates are approximate (town-centre / landmark level) and should be
 * checked against a map by the operations team before public launch.
 */
export class ReferenceData1762700000100 implements MigrationInterface {
  name = 'ReferenceData1762700000100';

  async up(q: QueryRunner): Promise<void> {
    // slug, name, local name, lat, lng, radius km, status, tagline, sort
    const regions: [string, string, string, number, number, number, string, string, number][] = [
      ['gokarna', 'Gokarna', 'ಗೋಕರ್ಣ', 14.5479, 74.3188, 15, 'live', 'Temple town, five beaches and the road between them', 1],
      ['kumta', 'Kumta', 'ಕುಮಟಾ', 14.4264, 74.4122, 12, 'coming_soon', 'Mirjan Fort, quiet beaches and the way to Yana', 2],
      ['honnavar', 'Honnavar', 'ಹೊನ್ನಾವರ', 14.2798, 74.4439, 12, 'coming_soon', 'Sharavathi backwaters and Apsarakonda', 3],
      ['murudeshwar', 'Murudeshwar', 'ಮುರುಡೇಶ್ವರ', 14.0943, 74.4845, 10, 'coming_soon', 'The sea-side Shiva and Netrani island', 4],
      ['karwar', 'Karwar', 'ಕಾರವಾರ', 14.8136, 74.129, 15, 'coming_soon', 'Kali river mouth, Tagore beach and the Goa border', 5],
    ];
    for (const [slug, name, local, lat, lng, radius, status, tagline, sort] of regions) {
      await q.query(
        `INSERT INTO regions (slug, name, name_local, state, center_lat, center_lng, radius_km, status, tagline, sort_order)
         VALUES ($1, $2, $3, 'Karnataka', $4, $5, $6, $7, $8, $9) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, local, lat, lng, radius, status, tagline, sort],
      );
    }

    // region slug, label, address, lat, lng, kind, sort
    const places: [string, string, string | null, number, number, string, number][] = [
      ['gokarna', 'Gokarna Bus Stand', 'KSRTC bus stand, Gokarna', 14.5452, 74.3197, 'transport', 1],
      ['gokarna', 'Gokarna Road Railway Station', 'Madanageri, 9 km from town', 14.5611, 74.3872, 'transport', 2],
      ['gokarna', 'Mahabaleshwar Temple', 'Car Street, Gokarna', 14.5434, 74.3163, 'temple', 3],
      ['gokarna', 'Maha Ganapati Temple', 'Car Street, Gokarna', 14.5436, 74.3172, 'temple', 4],
      ['gokarna', 'Koti Teertha', 'Temple tank, Gokarna', 14.5403, 74.3192, 'temple', 5],
      ['gokarna', 'Gokarna Main Beach', 'Beach road end, Gokarna', 14.5445, 74.314, 'beach', 6],
      ['gokarna', 'Kudle Beach', 'Kudle Beach road', 14.5318, 74.3162, 'beach', 7],
      ['gokarna', 'Om Beach', 'Om Beach parking', 14.5192, 74.3243, 'beach', 8],
      ['gokarna', 'Half Moon Beach', 'Trail head near Om Beach', 14.5122, 74.3295, 'beach', 9],
      ['gokarna', 'Paradise Beach', 'Belekan side trail head', 14.5068, 74.334, 'beach', 10],
      ['gokarna', 'Belekan Beach', 'Belekan village', 14.4983, 74.3415, 'beach', 11],
      ['gokarna', 'Tadadi Port', 'Tadadi fishing harbour', 14.5225, 74.3585, 'landmark', 12],
      ['gokarna', 'Sanikatta', 'Sanikatta salt village', 14.5417, 74.3683, 'town', 13],
      ['gokarna', 'Ankola Bus Stand', 'Ankola, NH 66', 14.6617, 74.304, 'transport', 14],
      ['kumta', 'Kumta Bus Stand', 'KSRTC bus stand, Kumta', 14.4266, 74.412, 'transport', 1],
      ['kumta', 'Kumta Railway Station', 'Station road, Kumta', 14.419, 74.429, 'transport', 2],
      ['kumta', 'Mirjan Fort', 'Mirjan, off NH 66', 14.4877, 74.4184, 'landmark', 3],
      ['kumta', 'Vannalli Beach', 'Vannalli, Kumta', 14.4305, 74.3855, 'beach', 4],
      ['kumta', 'Yana Caves', 'Yana, via Kathgal', 14.5897, 74.5664, 'landmark', 5],
      ['kumta', 'Vibhooti Falls', 'Mabagi, near Yana', 14.556, 74.545, 'landmark', 6],
      ['honnavar', 'Honnavar Bus Stand', 'KSRTC bus stand, Honnavar', 14.2802, 74.4437, 'transport', 1],
      ['honnavar', 'Honnavar Railway Station', 'Karki road, Honnavar', 14.2875, 74.4595, 'transport', 2],
      ['honnavar', 'Sharavathi Backwaters', 'Boating point, Honnavar', 14.276, 74.464, 'landmark', 3],
      ['honnavar', 'Apsarakonda Falls', 'Apsarakonda, Honnavar', 14.2484, 74.4429, 'landmark', 4],
      ['murudeshwar', 'Murudeshwar Temple', 'Kanduka hill, Murudeshwar', 14.0942, 74.4847, 'temple', 1],
      ['murudeshwar', 'Murudeshwar Railway Station', 'Station road, Murudeshwar', 14.1003, 74.5047, 'transport', 2],
      ['murudeshwar', 'Murudeshwar Beach', 'Beach road, Murudeshwar', 14.0935, 74.486, 'beach', 3],
      ['karwar', 'Karwar Bus Stand', 'KSRTC bus stand, Karwar', 14.8128, 74.1297, 'transport', 1],
      ['karwar', 'Karwar Railway Station', 'Shirwad, Karwar', 14.809, 74.177, 'transport', 2],
      ['karwar', 'Rabindranath Tagore Beach', 'Beach road, Karwar', 14.8167, 74.1242, 'beach', 3],
      ['karwar', 'Goa (Dabolim) Airport', 'Dabolim, Goa', 15.3808, 73.8314, 'transport', 4],
      ['karwar', 'Hubballi Airport', 'Gokul road, Hubballi', 15.3617, 75.0849, 'transport', 5],
    ];
    for (const [slug, label, address, lat, lng, kind, sort] of places) {
      await q.query(
        `INSERT INTO places (region_id, label, address, lat, lng, kind, sort_order)
         SELECT r.id, $2, $3, $4, $5, $6, $7 FROM regions r WHERE r.slug = $1
         ON CONFLICT (region_id, label) DO NOTHING`,
        [slug, label, address, lat, lng, kind, sort],
      );
    }

    // code, name, description, icon, seats, luggage, base, perKm, minPerKm, maxPerKm, waiting/hr, sort  (paise)
    const categories: [string, string, string, string, number, number, number, number, number, number, number, number][] = [
      ['auto', 'Auto rickshaw', 'Three-wheeler for short hops around town and to the beaches', 'auto', 3, 1, 4000, 1800, 1400, 3000, 6000, 1],
      ['bike', 'Bike taxi', 'A rider and a two-wheeler for one passenger', 'bike', 1, 0, 2500, 900, 600, 1500, 3000, 2],
      ['hatchback', 'Hatchback', 'Compact car for up to four', 'hatchback', 4, 2, 8000, 1600, 1200, 2400, 10000, 3],
      ['sedan', 'Sedan', 'Comfortable car with boot space for airport and station runs', 'sedan', 4, 3, 10000, 1800, 1400, 2800, 12000, 4],
      ['suv', 'SUV', 'Six seats and room for luggage - families and outstation trips', 'suv', 6, 4, 15000, 2200, 1700, 3500, 15000, 5],
      ['tempo_traveller', 'Tempo Traveller', 'Twelve-seater for groups and day tours', 'tempo_traveller', 12, 10, 30000, 3000, 2400, 4500, 25000, 6],
    ];
    for (const c of categories) {
      await q.query(
        `INSERT INTO vehicle_categories
           (code, name, description, icon, seats, luggage_capacity, base_fare_minor, per_km_minor,
            min_per_km_minor, max_per_km_minor, per_hour_waiting_minor, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (code) DO NOTHING`,
        c,
      );
    }

    const plans: [string, string, string, number, object, string[], boolean, number][] = [
      [
        'free', 'Starter', 'Get listed and start receiving enquiries.', 0,
        { maxVehicles: 1, monthlyQuoteLimit: 20, priorityInSearch: false, featuredDaysIncluded: 0, badge: null, analytics: false },
        ['One vehicle listing', 'Up to 20 quotes a month', 'Verified badge once approved'], false, 1,
      ],
      [
        'plus', 'Plus', 'More quotes, a better position in search and a look at your numbers.', 29900,
        { maxVehicles: 2, monthlyQuoteLimit: 100, priorityInSearch: true, featuredDaysIncluded: 2, badge: 'Plus', analytics: true },
        ['Two vehicle listings', 'Up to 100 quotes a month', 'Priority in search results', '2 featured days every month', 'Performance dashboard'],
        true, 2,
      ],
      [
        'pro', 'Pro', 'For full-time operators and small fleets.', 79900,
        { maxVehicles: 10, monthlyQuoteLimit: null, priorityInSearch: true, featuredDaysIncluded: 7, badge: 'Pro', analytics: true },
        ['Up to ten vehicles', 'Unlimited quotes', 'Priority in search results', '7 featured days every month', 'Performance dashboard'],
        false, 3,
      ],
    ];
    for (const [code, name, description, price, entitlements, highlights, recommended, sort] of plans) {
      await q.query(
        `INSERT INTO subscription_plans
           (code, name, description, price_minor, billing_period, entitlements, highlights, is_recommended, sort_order)
         VALUES ($1,$2,$3,$4,'monthly',$5::jsonb,$6,$7,$8) ON CONFLICT (code) DO NOTHING`,
        [code, name, description, price, JSON.stringify(entitlements), highlights, recommended, sort],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // Reference rows may be referenced by live data; removing them is only
    // safe on a database that holds nothing else.
    await q.query(`DELETE FROM places`);
    await q.query(`DELETE FROM subscription_plans WHERE code IN ('free','plus','pro')
                     AND NOT EXISTS (SELECT 1 FROM driver_subscriptions)`);
    await q.query(`DELETE FROM vehicle_categories WHERE NOT EXISTS (SELECT 1 FROM vehicles)
                     AND NOT EXISTS (SELECT 1 FROM ride_requests)`);
    await q.query(`DELETE FROM regions WHERE NOT EXISTS (SELECT 1 FROM places)`);
  }
}
