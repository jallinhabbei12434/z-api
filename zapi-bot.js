// zapi-bot.js (versão final com login funcional, Redis como fonte de status e TTL de 240s)
require('dotenv').config();
const { chromium } = require('playwright');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
const app = express();

const numero = process.argv[2];
const instancias = ['3E1CDD745BE3F0858A672ED5B439CBB7']; // substitua pelos IDs reais

(async () => {
  let instanciaSelecionada = null;

  for (const id of instancias) {
    const status = await redis.get(`instancia:${id}`);
    if (status === 'livre') {
      await redis.set(`instancia:${id}`, numero, 'EX', 240); // trava com número atual por 240s
      instanciaSelecionada = id;
      break;
    }
  }

  if (!instanciaSelecionada) {
    await redis.set(`${numero}`, 'lotado', 'EX', 240);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, {
      numero,
      disponibilidade: 'lotado'
    });
    process.exit(0);
  }
})();
app.use(express.json());

const sessions = {}; // Memória temporária por número

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
  const { numero, instanciaId } = req.body;
  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const instanciaKey = `instancia:${instanciaId}`;
  const statusKey = `${numero}`;

  const emUso = await redis.get(instanciaKey);
  if (emUso) {
    await redis.set(statusKey, 'lotado', 'EX', 240);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
    return res.json({ status: 'lotado' });
  }
  await redis.set(instanciaKey, numero, 'EX', 240);
  await redis.set(statusKey, 'pendente', 'EX', 240);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    sessions[numero] = { browser, context, page, instanciaId };

    const email = process.env.ZAPI_EMAIL;
    const senha = process.env.ZAPI_SENHA;

    console.log('Acessando login...');
    await page.goto('https://app.z-api.io/#/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', senha);
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Entrar")');

    console.log('Login realizado. Aguardando painel carregar...');
    await page.waitForTimeout(1000);

    console.log('Indo para Instâncias Mobile...');
    await page.goto('https://app.z-api.io/app/devices', { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForSelector('text=Desconectada', { timeout: 2000 });

    console.log('Clicando na instância...');
    await page.click('a[href*="visualization"]');

    console.log('Preenchendo número...');
    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);

    console.log('Clicando em Avançar...');
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
      console.log('Botão "Enviar sms" detectado. Clicando...');
      await page.click('button:has-text("Enviar sms")');
      console.log('Aguardando reação após clique em Enviar SMS...');
      await page.waitForTimeout(2000);

      if (await aparece('text=Este número se encontra bloqueado')) {
        status = 'bloqueado';
      } else if (await aparece('input[placeholder*="Código de confirmação"]')) {
        status = 'sms';
      } else {
        status = 'bloqueado';
      }
    } else {
      console.log('⚠️ Nenhum estado reconhecido após avançar. Considerando bloqueado.');
      status = 'bloqueado';
    }

    if (status === 'bloqueado') {
      await redis.set(statusKey, 'lotado', 'EX', 240);
      await redis.del(instanciaKey);
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
  const { numero, codigo } = req.body;
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
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Erro ao verificar código:', err);
    await redis.set(statusKey, 'erro', 'EX', 240);
    res.status(500).json({ erro: true });
  } finally {
    if (browser) await browser.close();
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
    await page.waitForTimeout(7000); // garantir que tela carregue

    // Revalidação se chegou à etapa do SMS novamente
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

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor do bot rodando...');
});
