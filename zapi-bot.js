require('dotenv').config();
const { chromium } = require('playwright');
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
    console.log('Número do usuário:', numero);

    await enviarWebhook(process.env.WEBHOOK_COLETA, { numero });

    const email = process.env.ZAPI_EMAIL;
    const senha = process.env.ZAPI_SENHA;

    if (!email || !senha) {
      throw new Error('Variáveis de ambiente não carregadas corretamente.');
    }

    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Acessando login...');
    await page.goto('https://app.z-api.io/#/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', senha);
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Entrar")');

    console.log('Login realizado. Aguardando painel carregar...');
    await page.waitForTimeout(1000);

    console.log('Indo para Instâncias Mobile...');
    await page.goto('https://app.z-api.io/app/devices');
    await page.waitForSelector('text=Desconectada', { timeout: 3000 });

    console.log('Clicando na instância...');
    await page.click('a[href*="visualization"]');

    console.log('Preenchendo número...');
    await page.fill('input.PhoneInputInput', `(${numero.slice(0, 2)}) ${numero.slice(2, 7)}-${numero.slice(7)}`);

    console.log('Clicando em Avançar...');
    await page.click('button:has-text("Avançar")');
    await page.waitForTimeout(2000);

    const bloqueioSelector = 'text=Este número se encontra bloqueado';
    const smsBtn = 'button:has-text("Enviar sms")';
    const codigoInput = 'input[placeholder*="Código de confirmação"]';

    let status = null;
    for (let i = 0; i < 10; i++) {
      if (await page.$(bloqueioSelector)) {
        status = 'bloqueado';
        break;
      } else if (await page.$(smsBtn)) {
        status = 'sms';
        break;
      } else if (await page.$(codigoInput)) {
        status = 'wa_old';
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (status === 'bloqueado') {
      console.log('Número bloqueado.');
      await enviarWebhook(resumeUrl, { disponibilidade: 'lotado', numero });
      await browser.close();
      return;
    }

    console.log('Número liberado.');
    await enviarWebhook(resumeUrl, { disponibilidade: 'ok', numero });

    if (status === 'sms') {
      console.log('Botão "Enviar sms" detectado. Clicando...');
      await page.click(smsBtn);

      try {
        console.log('Aguardando campo de código após SMS...');
        await page.waitForSelector('input[placeholder*="Código de confirmação"]', { timeout: 15000 });
        console.log('Campo de código detectado após envio de SMS.');
      } catch (e) {
        console.error('Erro: campo de código não apareceu após clique em Enviar SMS.');
        await enviarWebhook(process.env.WEBHOOK_DISPONIBILIDADE, { disponibilidade: 'erro_envio_sms', numero });
        await browser.close();
        return;
      }
    }

    sessions.byNumber.set(numero, { browser, page });

    const esperaApp = express();
    esperaApp.use(express.json());

    esperaApp.post('/codigo', async (req, res) => {
      const { code } = req.body;
      console.log('Código recebido:', code);

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

    esperaApp.listen(4000, () => {
      console.log('Aguardando código em http://localhost:4000/codigo');
    });

  } catch (error) {
    console.error('Erro durante execução do bot:', error.message);
  }
})();
