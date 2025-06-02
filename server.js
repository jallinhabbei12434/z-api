require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const { startBot, verifyCode, resendCode } = require('./zapi-bot');

// Rotas web
app.post('/start-bot', startBot);        // recebe dados e inicia fluxo do bot
app.post('/verify-code', verifyCode);    // recebe código e verifica na Z-API
app.post('/resend-code', resendCode);    // futuro: reenvio de código
app.get('/ping', (_, res) => res.send('pong')); // health-check

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`HTTP ON ${process.env.PORT || 3000}`);
});
