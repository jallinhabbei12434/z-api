const express = require('express');
const { exec } = require('child_process');
require('dotenv').config();
const sessions = require('./sessions');

const app = express();
app.use(express.json());

app.post('/start-bot', (req, res) => {
  const numero = req.body.numero;
  if (!numero) {
    return res.status(400).send('Número ausente');
  }

  console.log('Recebido número:', numero);
  exec(`node zapi-bot.js ${numero}`, (err, stdout, stderr) => {
    if (err) {
      console.error('Erro ao executar o bot:', err);
      return res.status(500).send('Erro ao executar o bot');
    }
    console.log('Bot stdout:', stdout);
    res.send('Bot iniciado com sucesso');
  });
});

// NOVO ENDPOINT: preenchimento de código
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

    // Fecha navegador após login e limpa sessão
    await sessao.browser.close();
    sessions.byNumber.delete(numero);

    res.json({ status: 'Código verificado e sessão conectada' });
  } catch (err) {
    console.error('Erro ao preencher código:', err);
    res.status(500).json({ error: 'Falha ao verificar o código' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});