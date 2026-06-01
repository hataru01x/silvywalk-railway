import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

async function queryOverpass(query) {
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  // Lancia tutte le richieste in parallelo
  // Il primo che risponde vince, gli altri vengono cancellati
  return new Promise((resolve, reject) => {
    let resolved = false;
    let errors = 0;

    servers.forEach((server, index) => {
      // Ogni server parte con un delay di 8 secondi dal precedente
      setTimeout(async () => {
        if (resolved) return;
        try {
          console.log(`Provo ${server}...`);
          const response = await fetch(server, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json',
              'User-Agent': 'SilvyWalk/1.0',
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(55000),
          });

          if (resolved) return;
          if (!response.ok) {
            console.log(`${server} status: ${response.status}`);
            errors++;
            if (errors === servers.length) reject(new Error('Tutti i server falliti'));
            return;
          }

          const text = await response.text();
          if (text.startsWith('<') || text.startsWith('Error')) {
            errors++;
            if (errors === servers.length) reject(new Error('Tutti i server falliti'));
            return;
          }

          if (!resolved) {
            resolved = true;
            console.log(`Risposta da ${server}`);
            resolve(JSON.parse(text));
          }
        } catch (e) {
          if (resolved) return;
          console.log(`${server} error: ${e.message}`);
          errors++;
          if (errors === servers.length) reject(new Error('Tutti i server falliti'));
        }
      }, index * 8000); // 0s, 8s, 16s
    });
  });
}

app.get('/', async (req, res) => {
  const { lat, lng, r } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat e lng richiesti' });

  const radius = r || '4000';
  const query = `[out:json][timeout:50];(node["tourism"~"alpine_hut|wilderness_hut"]["name"](around:${radius},${lat},${lng});node["natural"="peak"]["name"](around:${radius},${lat},${lng});node["mountain_pass"="yes"]["name"](around:${radius},${lat},${lng});node["amenity"="shelter"]["name"](around:${radius},${lat},${lng});way["highway"~"path|track"]["name"](around:${radius},${lat},${lng}););out body center qt;way["highway"~"path|track"]["name"](around:${radius},${lat},${lng});out geom qt;`;

  try {
    const data = await queryOverpass(query);
    res.json(data);
  } catch (e) {
    console.log('Tutti i server falliti:', e.message);
    res.status(500).json({ error: 'Server non disponibile' });
  }
});

app.get('/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q richiesto' });

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Italia')}&format=json&limit=1&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SilvyWalk/1.0',
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (data && data.length > 0) {
      res.json({
        found: true,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        name: data[0].display_name,
      });
    } else {
      res.json({ found: false });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`SilvyWalk proxy running on port ${PORT}`);
});
