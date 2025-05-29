const express = require('express');
const { exec } = require('child_process');
require('dotenv').config();

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
