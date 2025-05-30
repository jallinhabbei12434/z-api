const express = require('express');
const { spawn } = require('child_process');
require('dotenv').config();
const sessions = require('./sessions');

const app = express();
app.use(express.json());

// Inicia o bot para um número
app.post('/start-bot', (req, res) => {
  const numero = req.body.numero;
  if (!numero) {
    return res.status(400).send('Número ausente');
  }

  console.log('Recebido número:', numero);

  if (sessions.byNumber.has(numero)) {
    return res.status(400).send('Já existe um bot em execução para este número');
  }

  const bot = spawn('node', ['zapi-bot.js', numero]);

  bot.stdout.on('data', data => {
    console.log(`[BOT:${numero}] ${data.toString().trim()}`);
  });

  bot.stderr.on('data', data => {
    console.error(`[BOT:${numero}][ERRO] ${data.toString().trim()}`);
  });

  bot.on('close', code => {
    console.log(`[BOT:${numero}] Finalizado com código ${code}`);
  });

  res.send('Bot iniciado com sucesso');
});

// Recebe código de verificação e finaliza sessão
app.post('/verify-code', async (req, res) => {
  const { numero, codigo } = req.body;
  const sessao = sessions.byNumber.get(numero);

  if (!sessao) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }

  try {
    await sessao.page.fill('input[placeholder*="Código"]', codigo);
    await sessao.page.click('button:has-text("Confirmar")');
    await sessao.page.waitForSelector('text=/Conectad[oa]/', { timeout: 10000 });

    await sessao.browser.close();
    sessions.byNumber.delete(numero);

    res.json({ status: 'Código verificado e sessão conectada' });
  } catch (err) {
    console.error(`[BOT:${numero}][ERRO VERIFICAÇÃO]:`, err);
    res.status(500).json({ error: 'Falha ao verificar o código' });
  }
});

// Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
