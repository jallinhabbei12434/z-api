require('dotenv').config();
const { chromium } = require('playwright');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
const REDIS_TTL_MS = parseInt(process.env.REDIS_TTL_MS || '240000', 10);
const REDIS_TTL_SEC = Math.floor(REDIS_TTL_MS / 1000);
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

async function executarBot(numero, res) {
  let instanciaId = null;

  for (const id of instancias) {
    const status = await redis.get(`instancia:${id}`);
    if (!status || status === 'livre') {
      instanciaId = id;
      break;
    }
  }

  if (!instanciaId) {
    await redis.set(`${numero}`, 'lotado', 'EX', REDIS_TTL_SEC);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
    return res.json({ status: 'lotado' });
  }

  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const instanciaKey = `instancia:${instanciaId}`;
  const statusKey = `${numero}`;

  const emUso = await redis.get(instanciaKey);
  if (emUso && emUso !== 'livre') {
    await redis.set(statusKey, 'lotado', 'EX', REDIS_TTL_SEC);
    await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
    return res.json({ status: 'lotado' });
  }

  await redis.set(instanciaKey, numero, 'EX', REDIS_TTL_SEC);
  await redis.set(statusKey, 'pendente', 'EX', REDIS_TTL_SEC);
  await redis.set(`leadinst:${numero}`, instanciaId, 'EX', REDIS_TTL_SEC);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    sessions[numero] = { browser, context, page, instanciaId };
    sessions[numero].timeout = setTimeout(async () => {
      try {
        await browser.close();
      } catch (err) {
        console.error('Erro ao fechar navegador por timeout:', err.message);
      }
      delete sessions[numero];
      await redis.del(`instancia:${instanciaId}`);
    }, REDIS_TTL_MS);

    const aparece = async (seletor) => {
      try {
        await page.waitForSelector(seletor, { timeout: 1500 });
        return true;
      } catch {
        return false;
      }
    };

    await page.goto('https://app.z-api.io/#/login');
    await page.fill('input[type="email"]', process.env.ZAPI_EMAIL);
    await page.fill('input[type="password"]', process.env.ZAPI_SENHA);
    await page.click('button:has-text("Entrar")');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('login realizado');

    await page.goto('https://app.z-api.io/app/devices');
    await page.waitForSelector('text=Desconectada', { timeout: 3000 });
    await page.waitForSelector(`span.truncate.mr-2:has-text("${instanciaId}")`, { timeout: 3000 });

    const linkSelector = `a[href*="visualization/${instanciaId}"]`;
    console.log('🔎 Buscando link da instância...');
    const linkExiste = await page.$(linkSelector);
    if (!linkExiste) {
      console.error(`❌ Link da instância ${instanciaId} não encontrado na Z-API`);
      await redis.set(statusKey, 'erro', 'EX', REDIS_TTL_SEC);
      await redis.set(instanciaKey, 'livre');
      await browser.close();
      return res.status(400).json({ erro: 'Instância não encontrada na interface' });
    }

    console.log('✅ Clicando no link da instância...');
    await page.click(linkSelector);
    console.log('✅ Clicou no link da instância...');

    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(2000);
    console.log('Clicou em avançar!');

    let status = null;
    if (await aparece('text=Este número se encontra bloqueado')) {
  console.log(' NUMERO bloqueado.');
  process.stdout.write('');
      status = 'bloqueado';
} else if (await aparece('input[placeholder*="Código de confirmação"]')) {
  console.log('SOLITICTOU EM WA_OLD.');
  process.stdout.write('');
      status = 'wa_old';
} else if (await aparece('button:has-text("Enviar sms")')) {
  console.log('Botão "Enviar sms" detectado. Clicando...');
  process.stdout.write('');
  await page.click('button:has-text("Enviar sms")');

  console.log('Aguardando reação após clique em Enviar SMS...');
  process.stdout.write('');
  await page.waitForTimeout(2000);

  if (await aparece('text=Este número se encontra bloqueado')) {
    console.log(' NUMERO bloqueado.');
  process.stdout.write('');
    status = 'bloqueado';
  } else if (await aparece('input[placeholder*="Código de confirmação"]')) {
    console.log('SMS ENVIADO.');
  process.stdout.write('');
    status = 'sms';
} else {
  console.log('⚠️ Nenhum estado reconhecido após avançar. Considerando bloqueado.');
  process.stdout.write('');
  status = 'bloqueado';
} 
}

    if (status === 'bloqueado') {
      console.log('Bloqueado.');
  process.stdout.write('');
      await redis.set(statusKey, 'lotado', 'EX', REDIS_TTL_SEC);
      await redis.set(instanciaKey, 'livre');
      await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
      await browser.close();
      return res.json({ status: 'lotado' });
    }

    if (status === 'sms') {
      try {
        await page.waitForSelector('input[placeholder*="Código de confirmação"]', { timeout: 7000 });
        await redis.set(statusKey, 'aguardando_codigo', 'EX', REDIS_TTL_SEC);
        await context.storageState({ path: storageFile });
        await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'ok' });
        return res.json({ status: 'ok' });
      } catch (e) {
        await redis.set(statusKey, 'erro', 'EX', REDIS_TTL_SEC);
        await redis.del(instanciaKey);
        await browser.close();
        return res.json({ status: 'lotado' });
      }
    }
  if (status === 'wa_old') {
  console.log('⚠️ Código de verificação via WhatsApp detectado (wa_old)');
  await redis.set(statusKey, 'aguardando_codigo', 'EX', REDIS_TTL_SEC);
  await context.storageState({ path: storageFile });
  await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'ok' });
  return res.json({ status: 'ok' });
}
} catch (err) {
    console.error('Erro no bot:', err);
    await redis.set(`${numero}`, 'erro', 'EX', REDIS_TTL_SEC);
    if (browser) {
      clearTimeout(sessions[numero]?.timeout);
      await browser.close();
      delete sessions[numero];
    }
    return res.status(500).json({ erro: true });
  }
}

app.post('/start-bot', async (req, res) => {
  const { numero } = req.body;
  const timeout = 25000;

  try {
    await Promise.race([
      executarBot(numero, res),
      new Promise((_, reject) => setTimeout(() => reject(new Error('⏰ Timeout de execução')), timeout))
    ]);
  } catch (err) {
    console.error('Erro geral:', err.message);
    await redis.set(`${numero}`, 'erro', 'EX', REDIS_TTL_SEC);
    res.status(500).json({ erro: true });
  }
});
app.post('/verify-code', async (req, res) => {
  const { numero, code } = req.body;
  const session = sessions[numero];
  if (!session) return res.status(404).json({ erro: 'Sessão não encontrada' });

  const { page, browser, instanciaId } = session;
  const statusKey = `${numero}`;

  try {
    await page.fill('input[placeholder*="Código de confirmação"]', code);
    await page.click('button:has-text("Confirmar")');

    // Aguarda até 5s por alguma mudança na tela apos confirmar o codigo
    try {
      await page.waitForSelector('div[role="status"]', { timeout: 5000 });
    } catch {
      await page.waitForTimeout(5000);
    }

    const campoCodigo = await page.$('input[placeholder*="Código de confirmação"]');
    const divStatus = await page.$('div[role="status"][aria-live="polite"]');
    let codigoFalhou = false;

    if (campoCodigo) {
      codigoFalhou = true;
    } else if (divStatus) {
      const txt = (await divStatus.textContent()) || '';
      if (txt.includes('Código incorreto. Verifique e tente novamente.')) {
        codigoFalhou = true;
      }
    }

    if (codigoFalhou) {
      const atual = await redis.get(statusKey);
      const novoStatus = atual === 'aguardando_codigo' ? 'aguardando_codigo' : 'erro';
      await redis.set(statusKey, novoStatus, 'EX', REDIS_TTL_SEC);
      await redis.set(`instancia:${instanciaId}`, 'livre');
      return res.status(400).json({ erro: 'codigo_incorreto' });
    }

    await redis.set(statusKey, 'ok', 'EX', REDIS_TTL_SEC);
    await redis.set(`instancia:${instanciaId}`, 'conectado');

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Erro ao verificar código:', err);
    await redis.set(statusKey, 'erro', 'EX', REDIS_TTL_SEC);
    await redis.set(`instancia:${instanciaId}`, 'livre');
    res.status(500).json({ erro: true });
  } finally {
    clearTimeout(session.timeout);
    await browser.close();
    delete sessions[numero];
  }
});

app.post('/resend-code', async (req, res) => {
  const { numero } = req.body;
  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const instanciaId = await redis.get(`leadinst:${numero}`);
if (!instanciaId) return res.status(400).json({ erro: 'Instância não encontrada' });


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

    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(2000);
    console.log('Clicou em avançar!');

    const campoCodigo = await page.$('input[placeholder*="confirmação"]');
    if (campoCodigo) {
      await context.storageState({ path: storageFile });
      await redis.set(`${numero}`, "aguardando_codigo", "EX", REDIS_TTL_SEC);
      return res.status(200).json({ reenviado: true });
    } else {
      await redis.set(`${numero}`, "erro", "EX", REDIS_TTL_SEC);
      return res.status(400).json({ erro: 'Falha ao reenviar código' });
    }
  } catch (err) {
    console.error("Erro no /resend-code:", err.message);
    await redis.set(`${numero}`, "erro", "EX", REDIS_TTL_SEC);
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
