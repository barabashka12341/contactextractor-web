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

// Multiple user agents for rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Get random user agent
function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Enhanced email extraction with multiple strategies
async function extractEmailsFromUrl(url, retryCount = 0) {
  const maxRetries = 2;
  
  try {
    console.log(`🔍 [Попытка ${retryCount + 1}] Извлекаем контакты с: ${url}`);
    
    // Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Try different strategies
    const strategies = [
      // Strategy 1: Standard request
      async () => {
        const response = await axios.get(url, {
          timeout: 20000,
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
          },
          maxRedirects: 5,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          }
        });
        return response.data;
      },
      
      // Strategy 2: Request without some headers
      async () => {
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          maxRedirects: 3
        });
        return response.data;
      },
      
      // Strategy 3: Minimal headers
      async () => {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': getRandomUserAgent()
          }
        });
        return response.data;
      }
    ];
    
    let html = '';
    let strategyUsed = 0;
    
    // Try each strategy until one works
    for (let i = 0; i < strategies.length; i++) {
      try {
        console.log(`🔄 Стратегия ${i + 1} для ${url}`);
        html = await strategies[i]();
        strategyUsed = i + 1;
        break;
      } catch (error) {
        console.log(`❌ Стратегия ${i + 1} не сработала: ${error.message}`);
        if (i === strategies.length - 1) throw error;
      }
    }
    
    if (!html) {
      throw new Error('Не удалось получить содержимое страницы');
    }
    
    const $ = cheerio.load(html);
    const emails = [];
    
    // Enhanced email regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    
    // Strategy 1: Search in all text content
    $('*').each((i, element) => {
      const text = $(element).text();
      if (text && text.length > 0) {
        const matches = text.match(emailRegex);
        if (matches) {
          emails.push(...matches);
        }
      }
    });
    
    // Strategy 2: Search in href attributes
    $('a[href^="mailto:"]').each((i, element) => {
      const href = $(element).attr('href');
      if (href) {
        const email = href.replace('mailto:', '').trim();
        if (email.match(emailRegex)) {
          emails.push(email);
        }
      }
    });
    
    // Strategy 3: Search in data attributes
    $('[data-email], [data-mail]').each((i, element) => {
      const email = $(element).attr('data-email') || $(element).attr('data-mail');
      if (email && email.match(emailRegex)) {
        emails.push(email);
      }
    });
    
    // Strategy 4: Search in title and meta tags
    $('title, meta[name="description"], meta[property="og:description"]').each((i, element) => {
      const text = $(element).text() || $(element).attr('content');
      if (text) {
        const matches = text.match(emailRegex);
        if (matches) {
          emails.push(...matches);
        }
      }
    });
    
    // Clean and filter emails
    const uniqueEmails = [...new Set(emails)]
      .filter(email => {
        return email && 
               email.length > 5 && 
               email.length < 100 &&
               !email.includes('example.com') && 
               !email.includes('test.com') && 
               !email.includes('domain.com') &&
               !email.includes('localhost') &&
               !email.includes('127.0.0.1') &&
               email.includes('@') &&
               email.split('@')[1].includes('.');
      })
      .map(email => email.toLowerCase().trim());
    
    console.log(`✅ Стратегия ${strategyUsed}: Найдено ${uniqueEmails.length} email адресов на ${url}`);
    return uniqueEmails;
    
  } catch (error) {
    console.error(`❌ Ошибка при извлечении с ${url}:`, error.message);
    
    // Retry with different approach
    if (retryCount < maxRetries) {
      console.log(`🔄 Повторная попытка ${retryCount + 1}/${maxRetries} для ${url}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
      return extractEmailsFromUrl(url, retryCount + 1);
    }
    
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

    // Limit to 5 URLs to prevent overload
    const limitedUrls = urls.slice(0, 5);
    
    const jobId = Date.now().toString();
    activeJobs.set(jobId, {
      id: jobId,
      status: 'running',
      startTime: new Date(),
      urls: limitedUrls,
      results: [],
      processed: 0,
      total: limitedUrls.length
    });

    // Process URLs in background with better error handling
    (async () => {
      const allEmails = [];
      let processedCount = 0;
      let successCount = 0;
      
      for (const url of limitedUrls) {
        try {
          console.log(`🔄 Обрабатываем ${processedCount + 1}/${limitedUrls.length}: ${url}`);
          
          const emails = await extractEmailsFromUrl(url);
          
          if (emails.length > 0) {
            allEmails.push(...emails.map(email => ({ url, email })));
            successCount++;
            console.log(`✅ Успешно: ${url} - найдено ${emails.length} email`);
          } else {
            console.log(`⚠️ Не найдено email на ${url}`);
          }
          
          processedCount++;
          
          // Update job progress
          const job = activeJobs.get(jobId);
          if (job) {
            job.processed = processedCount;
            job.results = allEmails;
          }
          
          // Small delay between requests to be respectful
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`❌ Критическая ошибка при обработке ${url}:`, error.message);
          processedCount++;
        }
      }

      const job = activeJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.endTime = new Date();
        job.results = allEmails;
        job.successCount = successCount;
        console.log(`🎉 Завершено! Обработано: ${processedCount}/${limitedUrls.length}, Успешно: ${successCount}, Найдено email: ${allEmails.length}`);
      }
    })();

    res.json({ 
      success: true, 
      jobId,
      message: `Обработка ${limitedUrls.length} сайтов начата`,
      limited: urls.length > 5 ? `Ограничено до 5 сайтов из ${urls.length}` : null
    });
  } catch (error) {
    console.error('Ошибка при запуске извлечения:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  res.json({
    ...job,
    progress: job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0
  });
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    activeJobs: activeJobs.size,
    version: '2.0-robust'
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                   ║');
  console.log('║        🎯 CONTACT EXTRACTOR - УЛУЧШЕННАЯ ВЕРСИЯ 🎯              ║');
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌍 Сервер запущен на порту: ${PORT}`);
  console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);
  console.log('');
  console.log('🔧 Улучшения:');
  console.log('  ✅ Множественные стратегии извлечения');
  console.log('  ✅ Ротация User-Agent');
  console.log('  ✅ Повторные попытки с задержкой');
  console.log('  ✅ Улучшенная фильтрация email');
  console.log('  ✅ Ограничение нагрузки (макс. 5 сайтов)');
  console.log('  ✅ Подробное логирование');
  console.log('');
  console.log('📱 Откройте браузер и перейдите по указанному адресу');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

module.exports = app;
