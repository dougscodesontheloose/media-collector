# Segurança

O Media Collector é um projeto em desenvolvimento. A instalação concede acesso amplo às páginas HTTP e HTTPS e, opcionalmente, instala um auxiliar local com acesso à rede e aos arquivos do usuário. Instale somente código que você revisou e mantenha o navegador atualizado.

## Limitação conhecida

O caminho de análise de páginas do auxiliar nativo usa `yt-dlp` com uma URL HTTP(S) fornecida pela extensão. No estado atual, não há bloqueio completo de redirecionamentos nem de destinos que resolvam para loopback ou redes privadas. Por isso, esse caminho é experimental: não o use para páginas não confiáveis em uma rede que contenha serviços internos até que a validação de destinos seja concluída. Os downloads sem auxiliar continuam usando o navegador.

## Relatar uma vulnerabilidade

Não publique detalhes exploráveis, cookies, credenciais, URLs assinadas ou dados pessoais em issues públicas. Use **Report a vulnerability** na aba **Security** deste repositório para abrir um GitHub Security Advisory privado. Inclua a versão afetada, o impacto e passos mínimos para reproduzir, sem anexar conteúdo de terceiros.

Se o recurso de relatório privado não estiver disponível, abra uma issue pública apenas pedindo um canal privado, sem detalhes técnicos sensíveis.

Não há SLA de resposta ou política de recompensas neste projeto pessoal.
