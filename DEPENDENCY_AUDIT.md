# Auditoria de dependências — 5.0.1

**Data:** 23/11/2026
**Escopo:** pacotes npm travados em `package-lock.json`, usados pelo bundle de streaming ou incorporados à extensão. O auxiliar do sistema e os binários instalados separadamente não são cobertos por `npm audit`.

## Resultado

`npm audit` foi executado após `npm ci`, incluindo dependências de produção e de build. Resultado: **0 vulnerabilidades reportadas** na árvore travada. A lista e as versões estão em `package-lock.json`; `npm run build:streams` reconstrói `streams.js` a partir de `fonte/streams-entry.js`.

Antes da criação do lockfile, não era possível confirmar a versão de `@xmldom/xmldom` já embutida no bundle. `mpd-parser` 1.3.1 declara uma faixa compatível `^0.8.3`, que inclui versões antigas. O projeto agora fixa e sobrescreve essa dependência em **0.8.15**, recompila o bundle e audita a árvore exata. As versões 0.8.13, 0.8.14 e anteriores aparecem como afetadas em avisos que incluem correções de injeção XML e consumo quadrático; 0.8.15 contém essas correções para a linha 0.8.x: [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8), [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm), [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9), [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6).

## Componentes travados

- Streaming: `m3u8-parser` 7.2.0, `mpd-parser` 1.3.1, `@xmldom/xmldom` 0.8.15.
- Dependências transitivas: `@babel/runtime` 7.29.14, `@videojs/vhs-utils` 4.1.3, `global` 4.4.0, `dom-walk` 0.1.2, `min-document` 2.19.2 e `process` 0.11.10.
- Conversão: `@ffmpeg/ffmpeg` 0.12.15, `@ffmpeg/core` 0.12.10 e `@ffmpeg/types` 0.12.4.
- Build: `esbuild` 0.28.2, dependência de desenvolvimento; não é incluída como código executado pela extensão.

## O que fica fora

O `yt-dlp`, FFmpeg/ffprobe do sistema, navegador e componentes do próprio sistema operacional são executáveis externos, não pacotes desta árvore npm. Esta auditoria não verificou suas versões, origem, configuração ou vulnerabilidades. O resultado npm também depende do catálogo de advisories disponível na data da execução e não substitui revisão de código, teste de segurança ou auditoria da build distribuída.
