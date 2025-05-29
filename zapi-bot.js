require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  try {
    const numero = process.argv[2];
    console.log('Iniciando bot...');
    console.log('Número do usuário:', numero);

    const email = process.env.ZAPI_EMAIL;
    const senha = process.env.ZAPI_SENHA;

    if (!email || !senha) {
      throw new Error('Variáveis de ambiente não carregadas corretamente.');
    }

    const browser = await chromium.launch({ headless: false });
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

    console.log('Aguardando página após avançar...');
    const smsBtn = 'button:has-text("Enviar sms")';
    const codigoInput = 'input[placeholder*="Código de confirmação"]';

    const result = await Promise.race([
      page.waitForSelector(smsBtn, { timeout: 8000 }).then(() => 'sms'),
      page.waitForSelector(codigoInput, { timeout: 8000 }).then(() => 'wa_old')
    ]);

    if (result === 'sms') {
      console.log('Botão "Enviar sms" detectado. Clicando...');
      await page.click(smsBtn);
    } else if (result === 'wa_old') {
      console.log('Campo para código detectado (wa_old). Prosseguindo...');
    } else {
      console.warn('Nenhuma opção detectada após avançar.');
    }

  } catch (error) {
    console.error('Erro durante execução do bot:', error.message);
  }
})();
