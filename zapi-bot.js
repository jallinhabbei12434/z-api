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


  const executarBot = async (numero, res) => {

  for (const id of instancias) {
    const status = await redis.get(`instancia:${id}`);
    if (!status || status === 'livre') {
      instanciaId = id;
      break;
    }
  }
let instanciaId = null;
  
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
async function aparece(seletor) {
  try {
    await page.waitForSelector(seletor, { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}
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
  await redis.set(statusKey, 'erro', 'EX', 240);
  await redis.set(instanciaKey, 'livre');
  await browser.close();
  return res.status(400).json({ erro: 'Instância não encontrada na interface' });
}

console.log('✅ Clicando no link da instância...');
await page.click(linkSelector);
console.log('✅ Clicou no link da instância...');


    console.log('Preenchendo número...');
process.stdout.write('');
    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);

    console.log('Clicando em Avançar...');
process.stdout.write('');
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(2000);

    const bloqueioSelector = 'text=Este número se encontra bloqueado';
    const smsBtn = 'button:has-text("Enviar sms")';
    const codigoInput = 'input[placeholder*="Código de confirmação"]';

    let status = null;
    
    if (await aparece('text=Este número se encontra bloqueado')) {
  status = 'bloqueado';
} else if (await aparece('input[placeholder*="Código de confirmação"]')) {
  status = 'wa_old';
} else if (await aparece('button:has-text("Enviar sms")')) {
  console.log('Botão "Enviar sms" detectado. Clicando...');
  process.stdout.write('');
  await page.click('button:has-text("Enviar sms")');

  console.log('Aguardando reação após clique em Enviar SMS...');
  process.stdout.write('');
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
  process.stdout.write('');
  status = 'bloqueado';
}
    if (status === 'bloqueado') {
      console.log('Numero bloquado.');
      process.stdout.write('');
      await redis.set(statusKey, 'lotado', 'EX', 240);
      await redis.set(instanciaKey, 'livre');
      await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado' });
      await browser.close();
      return res.json({ status: 'bloqueado' });
      
    }

    if (status === 'sms') {
      try {
        console.log('clicando em SMS.');
      process.stdout.write('');
        await page.waitForSelector('input[placeholder*="Código de confirmação"]', { timeout: 7000 });
        await redis.set(statusKey, 'aguardando_codigo', 'EX', 240);
        await context.storageState({ path: storageFile });
        await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'ok' });
        console.log('SMS ENVIADO.');
      process.stdout.write('');
        return res.json({ status: 'aguardando_codigo' });
      } catch (e) {
        await redis.set(statusKey, 'erro', 'EX', 240);
        await redis.del(instanciaKey);
        await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { numero, disponibilidade: 'lotado', instanciaId });
        console.log('SMS ERRO.');
      process.stdout.write('');
        await browser.close();
        return res.json({ status: 'bloqueado' }); // 🔁 Se bloqueado, avisa também
      }
    } else {
      await redis.set(statusKey, 'erro', 'EX', 240);
      await redis.del(instanciaKey);
      await browser.close();
      return res.json({ status: 'bloqueado' });;
    }
  } catch (err) {
    console.error('Erro no bot:', err);
    await redis.set(statusKey, 'erro', 'EX', 240);
    await redis.del(instanciaKey);
    res.status(500).json({ erro: true });
  }
  throw new Error('Status desconhecido ou nenhum retorno válido');
};
app.post('/start-bot', async (req, res) => {
  const { numero } = req.body;

  const timeout = 25000; // 25 segundos
  try {
    await Promise.race([
      executarBot(numero, res),
      new Promise((_, reject) => setTimeout(() => reject(new Error('⏰ Timeout de execução')), timeout))
    ]);
  } 
    catch (err) {
    console.error('Erro geral:', err.message);
    await redis.set(`${numero}`, 'erro', 'EX', 240);
    res.status(500).json({ erro: true });
  }  
app.post('/verify-code', async (req, res) => {
  const { numero, codigo } = req.body;
  const instanciaId = await redis.get(`leadinst:${numero}`);
if (!instanciaId) {
  return res.status(400).json({ erro: 'Instância não encontrada para esse número' });
}

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
    console.log('CÓDIGO PREENCHIDO.');
      process.stdout.write('');

    await sleep(3000);
    await redis.set(statusKey, 'ok', 'EX', 240);
    await redis.set(`instancia:${sessions[numero].instanciaId}`, 'conectado');

    res.json({ status: 'ok' });
  } catch (err) {
  console.error('Erro ao verificar código:', err);
  await redis.set(statusKey, 'erro', 'EX', 240);
  await redis.set(`instancia:${instanciaId}`, 'livre'); // ⬅ importante aqui também
  res.status(500).json({ erro: true });
}
});

app.post('/resend-code', async (req, res) => {
  const { numero } = req.body;
  const storageFile = path.resolve(__dirname, 'sessions', `${numero}.json`);
  const instanciaId = await redis.get(`instancia:${numero}`); // ou leadinst:${numero} se ainda usar
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
