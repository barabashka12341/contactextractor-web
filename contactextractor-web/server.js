const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store for active jobs
const activeJobs = new Map();

// Email extraction function
async function extractEmailsFromUrl(url) {
  try {
    console.log(`🔍 Извлекаем контакты с: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const emails = [];

    // Extract emails from various elements
    $('*').each((i, element) => {
      const text = $(element).text();
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = text.match(emailRegex);
      if (matches) {
        emails.push(...matches);
      }
    });

    return [...new Set(emails)]; // Remove duplicates
  } catch (error) {
    console.error(`❌ Ошибка при извлечении с ${url}:`, error.message);
    return [];
  }
}

// API Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/extract', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || urls.length === 0) {
      return res.status(400).json({ error: 'URLs are required' });
    }

    const jobId = Date.now().toString();
    activeJobs.set(jobId, {
      id: jobId,
      status: 'running',
      startTime: new Date(),
      urls,
      results: []
    });

    // Process URLs in background
    (async () => {
      const allEmails = [];
      for (const url of urls) {
        const emails = await extractEmailsFromUrl(url);
        allEmails.push(...emails.map(email => ({ url, email })));
      }

      const job = activeJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.endTime = new Date();
        job.results = allEmails;
      }
    })();

    res.json({ success: true, jobId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/job/:jobId/download', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'Job not found or not completed' });
  }

  const csv = 'URL,Email\n' + job.results.map(r => `${r.url},${r.email}`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
  res.send(csv);
});

// Health check for cloud platforms
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                   ║');
  console.log('║            🎯 CONTACT EXTRACTOR - ОБЛАЧНЫЙ СЕРВЕР 🎯            ║');
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌍 Сервер запущен на порту: ${PORT}`);
  console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);
  console.log('');
  console.log('📱 Откройте браузер и перейдите по указанному адресу');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

module.exports = app;
