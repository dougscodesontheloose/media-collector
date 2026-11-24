# Media Collector para Safari no macOS

Este diretório contém o primeiro alvo nativo do Media Collector para Safari. A
versão Chromium permanece na raiz do repositório. Os detectores, adaptadores e a
interface são sincronizados da raiz pelo script `sync-extension-resources.sh`;
o manifesto, a ponte de página e a camada de compatibilidade são específicos do
Safari.

## Estado desta etapa

- projeto Xcode macOS e Safari Web Extension gerados para a versão 5.3.0;
- painel aberto pelo ícone da extensão;
- ponte para os observadores de página que no Chromium usam `world: MAIN`;
- download inicial de arquivos HTTP(S) diretos pelo aplicativo nativo para
  `Downloads/Media Collector/<origem>`;
- nenhum servidor, telemetria, analytics ou código remoto foi adicionado.

Ainda não há paridade para escolha de pasta, pausa/retomada nativa, processamento
HLS/DASH, montagem de faixas separadas e fluxos que dependem do auxiliar Python.
Essas ações devem falhar de forma explícita até serem migradas para Swift.

## Atualizar recursos compartilhados

Execute:

```sh
platforms/safari/sync-extension-resources.sh
```

O script não substitui `manifest.json` nem os arquivos `safari-*.js`.

## Compilar localmente

Abra `Media Collector/Media Collector.xcodeproj` no Xcode, selecione o esquema
macOS e use **Product > Run**. Para uma build local sem conta de desenvolvedor,
habilite extensões não assinadas nas configurações de Desenvolvedor do Safari.

O alvo mínimo é Safari 16.4 / macOS 13.3 por causa de `storage.session`.
