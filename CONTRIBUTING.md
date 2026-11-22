# Contribuir

Contribuições pequenas e verificáveis são bem-vindas. Antes de abrir uma issue ou pull request:

1. Descreva o navegador, o tipo de página e a classe de mídia, sem incluir cookies, tokens, URLs assinadas ou conteúdo privado.
2. Explique o resultado esperado e o resultado observado; informe se o teste foi fixture, simulador ou página ao vivo.
3. Para mudanças de código, rode:

   ```sh
   node --test testes/*.test.js
   python3 -B testes/native_destination_test.py
   ```

4. Mantenha os adaptadores de sites isolados e evite registrar URLs completas ou dados de sessão em logs.
5. Preserve os avisos de licença de qualquer código ou binário de terceiros incluído.

Pull requests não devem adicionar cookies, credenciais, arquivos de mídia baixados, logs de sessão nem builds de revisão locais.
