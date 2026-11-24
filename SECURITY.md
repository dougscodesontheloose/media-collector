# Segurança

Media Collector 5.3.0 é uma candidata experimental para Chromium. A extensão pede acesso amplo a páginas HTTP e HTTPS para localizar mídia na web aberta. O auxiliar nativo é opcional e, quando instalado, pode acessar a rede pública e gravar arquivos no destino escolhido.

## Controles e limites

- O manifesto não solicita permissões `cookies` ou `history`; a extensão não chama a API de cookies nem exporta cookies. O resolvedor de manifestos usa `credentials: include` em requisições HTTP(S), então o navegador pode aplicar cookies de sessão disponíveis ao recurso solicitado.
- O código da extensão não carrega scripts remotos nem declara telemetria. A revisão estática anterior teve cobertura parcial; isto não equivale a uma auditoria completa do produto.
- O auxiliar valida URLs HTTP(S), rejeita nomes/IPs que resolvam para endereços não globais, fixa os endereços validados em conexões diretas e revalida redirecionamentos. O `yt-dlp` é executado com configuração externa desativada e usa um proxy local autenticado por tarefa para requisições HTTP(S); outros protocolos que não passam por essa fronteira não devem ser considerados cobertos.
- O auxiliar e os executáveis externos instalados pelo usuário (`yt-dlp`, FFmpeg e `ffprobe`) ampliam o impacto potencial de uma falha. Eles não são um sandbox do sistema. Instale somente binários confiáveis e mantenha-os atualizados.
- O projeto não tenta contornar DRM, criptografia de mídia, paywalls ou autenticação. O acesso depende do que o site disponibiliza ao navegador e da sessão legítima do usuário.
- As permissões de host são amplas por causa do modo de uso em sites arbitrários. Revise o código antes de instalar e desative a extensão quando não precisar dela.

## Verificação registrada

Em 23/11/2026, `npm audit` foi executado contra o `package-lock.json` da árvore 5.0.1 e não reportou vulnerabilidades. O bundle `streams.js` foi recompilado com dependências travadas, incluindo `@xmldom/xmldom` 0.8.15. As suítes automatizadas e as verificações do auxiliar cobrem caminhos documentados, mas não todos os protocolos, players, binários do sistema ou cenários reais de cada site. Consulte [`DEPENDENCY_AUDIT.md`](DEPENDENCY_AUDIT.md) e a matriz de validação no [`README.md`](README.md).

## Relatar uma vulnerabilidade

Não publique detalhes exploráveis, cookies, credenciais, URLs assinadas ou dados pessoais em issues públicas. Use **Report a vulnerability** na aba **Security** deste repositório para abrir um GitHub Security Advisory privado. Inclua a versão afetada, o impacto e passos mínimos para reproduzir, sem anexar conteúdo de terceiros.

Se o recurso de relatório privado não estiver disponível, abra uma issue pública apenas pedindo um canal privado, sem detalhes técnicos sensíveis. Não há SLA de resposta ou política de recompensas neste projeto pessoal.
