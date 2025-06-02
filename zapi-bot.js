require('dotenv').config();
const { chromium } = require('playwright');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
const app = express();
const instancias = process.env.INSTANCIAS.split(',');


app.use(express.json());

const sessions = {};

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function enviarWebhook(url, dados) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
  } catch (err) {
    console.error('Erro ao enviar webhook:', err.message);
  }
}

app.post('/start-bot', async (req, res) => {
  const { numero } = req.body;
  let instanciaId = null;

  for (const id of instancias) {
    const status = await redis.get(`instancia:${id}`);
    if (!status || status === 'livre') {
      instanciaId = id;
      break;
    }
  }

  if (!instanciaId) {
    await redis.set(`${numero}`, 'lotado', 'EX', 240);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
    return res.json({ status: 'lotado' });
  }

  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const instanciaKey = `instancia:${instanciaId}`;
  const statusKey = `${numero}`;

  const emUso = await redis.get(instanciaKey);
  if (emUso && emUso !== 'livre') {
    await redis.set(statusKey, 'lotado', 'EX', 240);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
    return res.json({ status: 'lotado' });
  }

  await redis.set(instanciaKey, numero, 'EX', 240);
  await redis.set(statusKey, 'pendente', 'EX', 240);
await redis.set(`leadinst:${numero}`, instanciaId, 'EX', 240);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    sessions[numero] = { browser, context, page, instanciaId };

    await page.goto('https://app.z-api.io/#/login');
await page.fill('input[type="email"]', process.env.ZAPI_EMAIL);
await page.fill('input[type="password"]', process.env.ZAPI_SENHA);
await page.waitForTimeout(1000);
await page.click('button:has-text("Entrar")');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'antes-do-devices.png' });

await page.goto('https://app.z-api.io/app/devices');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'antes-do-devices2.png' });

// Verifica se a instância desejada está visível
const instanciaLink = await page.$(`text=${instanciaId}`);
if (!instanciaLink) {
  console.error(`❌ Instância ${instanciaId} não encontrada na página da Z-API`);
  await redis.set(statusKey, 'erro', 'EX', 240);
  await redis.set(`instancia:${instanciaId}`, 'livre');
  await browser.close();
  return;
}

// Clica no <a> pai do <span> com o ID
await instanciaLink.evaluate(el => {
  const link = el.closest('a');
  if (link) link.click();
});


await instanciaAlvo.click();

    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(2000);

    const aparece = async (selector) => {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        return true;
      } catch (_) {
        return false;
      }
    };

    let status = null;
    if (await aparece('text=Este número se encontra bloqueado')) {
      status = 'bloqueado';
    } else if (await aparece('input[placeholder*="Código de confirmação"]')) {
      status = 'wa_old';
    } else if (await aparece('button:has-text("Enviar sms")')) {
      await page.click('button:has-text("Enviar sms")');
      await page.waitForTimeout(2000);

      if (await aparece('text=Este número se encontra bloqueado')) {
        status = 'bloqueado';
      } else if (await aparece('input[placeholder*="Código de confirmação"]')) {
        status = 'sms';
      } else {
        status = 'bloqueado';
      }
    } else {
      status = 'bloqueado';
    }

    if (status === 'bloqueado') {
      await redis.set(statusKey, 'lotado', 'EX', 240);
      await redis.set(instanciaKey, 'livre');
      await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
      await browser.close();
      return;
    }

    if (status === 'sms') {
      try {
        await page.waitForSelector('input[placeholder*="Código de confirmação"]', { timeout: 7000 });
        await redis.set(statusKey, 'aguardando_codigo', 'EX', 240);
        await context.storageState({ path: storageFile });
        await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'ok' });
        res.json({ status: 'aguardando_codigo' });
      } catch (e) {
        await redis.set(statusKey, 'erro', 'EX', 240);
        await redis.del(instanciaKey);
        await enviarWebhook(process.env.WEBHOOK_COLETA, { numero, disponibilidade: 'lotado', instanciaId });
        await browser.close();
        return;
      }
    } else {
      await redis.set(statusKey, 'erro', 'EX', 240);
      await redis.del(instanciaKey);
      await browser.close();
      return;
    }
  } catch (err) {
    console.error('Erro no bot:', err);
    await redis.set(statusKey, 'erro', 'EX', 240);
    await redis.del(instanciaKey);
    res.status(500).json({ erro: true });
  }
});


app.post('/verify-code', async (req, res) => {
  const { numero, codigo, instanciaId } = req.body;
await redis.set(`instancia:${instanciaId}`, 'livre');
  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const statusKey = `${numero}`;

  if (!fs.existsSync(storageFile)) {
    return res.status(404).json({ erro: 'Sessão não encontrada' });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: storageFile });
    const page = await context.newPage();

    await page.waitForSelector('input[placeholder*="Código de confirmação"]');
    await page.fill('input[placeholder*="Código de confirmação"]', codigo);
    await page.click('button:has-text("Confirmar")');

    await sleep(3000);
    await redis.set(statusKey, 'ok', 'EX', 240);
    await redis.set(`instancia:${sessions[numero].instanciaId}`, 'livre');

    res.json({ status: 'ok' });
  } catch (err) {
  console.error('Erro ao verificar código:', err);
  await redis.set(statusKey, 'erro', 'EX', 240);
  await redis.set(`instancia:${instanciaId}`, 'livre'); // ⬅ importante aqui também
  res.status(500).json({ erro: true });
}
});

app.post('/resend-code', async (req, res) => {
  const { numero, instanciaId } = req.body;
  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);

  if (!fs.existsSync(storageFile)) {
    return res.status(400).json({ erro: 'Sessão não encontrada' });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: storageFile });
  const page = await context.newPage();

  try {
    await page.goto(`https://painel.z-api.io/app/devices/visualization/${instanciaId}`);
    await page.waitForSelector('span.cursor-pointer:has-text("Alterar")', { timeout: 1500 });
    await page.click('span.cursor-pointer:has-text("Alterar")');

    await page.waitForSelector('input[type="tel"]', { timeout: 1500 });
    await page.fill('input[type="tel"]', numero);
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(7000);

    const campoCodigo = await page.$('input[placeholder*="confirmação"]');
    if (campoCodigo) {
      await context.storageState({ path: storageFile });
      await redis.set(`${numero}`, "aguardando_codigo", "EX", 240);
      return res.status(200).json({ reenviado: true });
    } else {
      await redis.set(`${numero}`, "erro", "EX", 240);
      return res.status(400).json({ erro: 'Falha ao reenviar código' });
    }
  } catch (err) {
    console.error("Erro no /resend-code:", err.message);
    await redis.set(`${numero}`, "erro", "EX", 240);
    return res.status(500).json({ erro: 'Erro ao reenviar' });
  } finally {
    await browser.close();
    await redis.del(`instancia:${instanciaId}`);
  }
});

app.get('/ping', (_, res) => res.send('pong'));

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`HTTP ON ${process.env.PORT || 3000}`);
});
