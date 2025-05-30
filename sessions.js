module.exports = {
  byNumber: new Map(),

  // Limpeza automática de sessões antigas (a cada 5 minutos)
  cleanup() {
    setInterval(() => {
      const now = Date.now();

      for (const [numero, session] of this.byNumber) {
        if (now - session.timestamp > 7 * 60 * 1000) { // 7 minutos
          try {
            session.browser.close(); // Libera o Chromium
          } catch (err) {
            console.error(`Erro ao fechar navegador da sessão ${numero}:`, err.message);
          }
          this.byNumber.delete(numero);
          console.log(`🗑️ Sessão expirada para ${numero}`);
        }
      }

    }, 5 * 60 * 1000); // Verifica a cada 5 minutos
  }
};
