require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const sessions = require('./sessions');

async function enviarWebhook(url, dados) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
  } catch (err) {
    console.error('Erro ao enviar webhook:', err.message);
  }
}
(async () => {
  try {
    const numero = process.argv[2];
    console.log('Iniciando bot...');
process.stdout.write('');
    console.log('Número do usuário:', numero);
process.stdout.write('');

    const email = process.env.ZAPI_EMAIL;
    const senha = process.env.ZAPI_SENHA;

    if (!email || !senha) {
      throw new Error('Variáveis de ambiente não carregadas corretamente.');
    }

    const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium', // caminho usado no Easypanel
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

    const context = await browser.newContext();
    const page = await context.newPage();
async function aparece(seletor) {
  try {
    await page.waitForSelector(seletor, { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

    console.log('Acessando login...');
process.stdout.write('');
    await page.goto('https://app.z-api.io/#/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', senha);
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Entrar")');

    console.log('Login realizado. Aguardando painel carregar...');
process.stdout.write('');
    await page.waitForTimeout(1000);

    console.log('Indo para Instâncias Mobile...');
process.stdout.write('');
    await page.goto('https://app.z-api.io/app/devices');
    await page.waitForSelector('text=Desconectada', { timeout: 3000 });

    console.log('Clicando na instância...');
process.stdout.write('');
    await page.click('a[href*="visualization"]');

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
      console.log('Número bloqueado.');
process.stdout.write('');
      await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { disponibilidade: 'lotado' });
      await browser.close();
      return;
    }

    console.log('Número liberado.');
process.stdout.write('');
await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { disponibilidade: 'ok' });

if (status === 'sms') {
  try {
    console.log('Aguardando campo de código após SMS...');
    process.stdout.write('');
    await page.waitForSelector('input[placeholder*="Código de confirmação"]', { timeout: 7000 });
    console.log('Campo de código detectado após envio de SMS.');
    process.stdout.write('');
  } catch (e) {
    console.error('Erro: campo de código não apareceu após clique em Enviar SMS.');
    await enviarWebhook(process.env.WEBHOOK_COLETA, { disponibilidade: 'lotado' });
    await browser.close();
    return;
  }
}


    sessions.byNumber.set(numero, { browser, page });

    const esperaApp = express();
    esperaApp.use(express.json());

esperaApp.post('/codigo', async (req, res) => {
  const { numero, code } = req.body;

  const sessao = sessions.byNumber.get(numero);
  if (!sessao) {
    return res.status(400).send('Sessão não encontrada para esse número');
  }

  const { browser, page } = sessao;

  console.log('Código recebido:', code);
  process.stdout.write('');

  try {
    await page.fill('input[placeholder*="Código"]', code);
    await page.click('button:has-text("Confirmar")');
    await page.waitForSelector('text=/Conectad[oa]/', { timeout: 15000 });

    await enviarWebhook(process.env.WEBHOOK_VALIDACAO, { validado: 'true', numero });
    await browser.close();
    res.send('Código processado com sucesso');
    process.exit(0);
  } catch (e) {
    console.error('Erro ao preencher código:', e.message);
    res.status(500).send('Erro ao processar o código');
  }
});


    

  } catch (error) {
    console.error('Erro durante execução do bot:', error.message);
  }
})();
