const { CookieJar } = require('tough-cookie');

// Cookie jar único compartilhado entre todos os clientes HTTP.
// tough-cookie armazena cookies por domínio automaticamente, então
// gcid.gamersclub.gg e gamersclub.com.br ficam separados no mesmo jar.
const jar = new CookieJar();

module.exports = jar;
