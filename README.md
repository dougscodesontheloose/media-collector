# Media Collector

Extensão experimental Manifest V3 para Chromium que ajuda a localizar e salvar fotos, vídeos e áudio que uma página já disponibiliza ao navegador. O processamento e o histórico são locais. O projeto não usa servidor próprio de extração, API oficial ou telemetria.

**Repositório:** <https://github.com/dougscodesontheloose/media-collector> · **Estado:** linha 5.0.1 em desenvolvimento. A cobertura varia por site e formato; consulte [validação atual](#validação-e-limites-conhecidos) e a [matriz de paridade com as quatro referências](MATRIZ_PARIDADE.md).

Use a extensão somente com conteúdo que você tenha direito de salvar e respeite as regras e permissões do site. Ela não contorna DRM, paywalls ou controles de acesso.

## O que faz

- Procura imagens e players na página aberta, inclusive em páginas dinâmicas e em quadros que o navegador permita inspecionar.
- Mostra controles discretos sobre imagens elegíveis e atalhos em publicações suportadas de Instagram, X e Reddit.
- Em carrosséis do Instagram, tenta enfileirar de uma vez as imagens e vídeos-filhos grandes já renderizados no post. Se o site ainda só tiver carregado o slide atual, mantém o avanço visual como fallback.
- Mantém um painel lateral para revisar candidatos, selecionar itens, acompanhar a fila e consultar falhas.
- Identifica arquivos diretos e tenta processar manifestos HLS e DASH sob demanda, quando não criptografados e quando os dados disponíveis bastam para reconstruí-los.
- Observa tráfego de mídia reconhecível e, por ação do usuário, pode tentar capturas temporárias de players MSE compatíveis.
- Salva os arquivos localmente, com destino configurável. O auxiliar nativo opcional permite escolher uma pasta e analisar páginas usando ferramentas instaladas no computador.

Esses recursos não garantem a captura de todos os itens de um perfil ou site. Links temporários, players fechados, formatos incompatíveis, expiração de URLs, conteúdo protegido e mudanças nas páginas podem impedir a detecção ou o download.

## Instalar no Chrome ou Brave

1. Baixe o código pelo botão **Code → Download ZIP** ou clone o repositório:

   ```sh
   git clone https://github.com/dougscodesontheloose/media-collector.git
   cd media-collector
   ```

2. Abra `chrome://extensions/` no Chrome ou `brave://extensions/` no Brave.
3. Ative **Modo do desenvolvedor** e selecione **Carregar sem compactação**.
4. Escolha a pasta que contém `manifest.json`.
5. Fixe o ícone da extensão, abra o painel e recarregue as abas que já estavam abertas.

Para atualizar uma instalação clonada, execute `git pull` na pasta e use **Recarregar** na página de extensões. Recarregue também as páginas do navegador para atualizar os content scripts.

## Auxiliar nativo opcional no macOS

Sem o auxiliar, os downloads usam o mecanismo do navegador. O auxiliar local é necessário para alguns destinos personalizados, processamento adicional e análise de páginas com `yt-dlp`. Ele é opcional e não recebe cookies exportados pelo Media Collector. A análise com `yt-dlp` depende de fontes acessíveis pelas ferramentas instaladas; não promete compatibilidade universal.

Instale `yt-dlp`, `ffmpeg` e `ffprobe` no sistema e confirme que os executáveis estão no `PATH` ou nos diretórios conhecidos pelo auxiliar. Com a extensão carregada, copie o ID exibido na página de extensões e registre o host:

```sh
python3 native/install.py --browser chrome --extension-id SEU_ID_DA_EXTENSAO
python3 native/install.py --browser brave --extension-id SEU_ID_DA_EXTENSAO
```

No macOS, o Brave configura o Native Messaging para consultar `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`, o mesmo diretório padrão do Chrome. Portanto, `--browser brave` é um alias explícito para esse registro compartilhado; não cria um manifesto duplicado. O instalador mantém IDs de extensão já autorizados no manifesto. O caminho consta no [código-fonte do Brave](https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc#L847-L888). O handshake foi confirmado em um perfil Brave isolado: a extensão recebeu `pong` do auxiliar e ele reportou FFmpeg disponível. Isso valida a conexão Native Messaging, não a publicação de uma mídia no destino nativo.

## Uso

1. Abra a página que contém a mídia.
2. Para uma imagem, passe o mouse sobre uma imagem elegível e clique no botão discreto; também é possível focá-lo pelo teclado.
3. Para uma publicação suportada, use o botão junto aos controles da publicação. Em carrosséis, itens-filhos já expostos no DOM são coletados em lote; se não estiverem carregados, o atalho percorre os slides acessíveis como fallback.
4. Abra o painel para atualizar a lista, escolher mídias, definir formato, pasta e acompanhar a fila.
5. Confira o estado final do item. Uma notificação de fila iniciada não significa que o arquivo foi salvo.

No Instagram, os atalhos podem aparecer em publicações, Reels e Stories acessíveis na sessão; Stories/Reels podem usar buffers temporários do player. No X, o atalho associa fontes ao post e ao poster exibidos. Dois posts públicos tiveram downloads completos em uma rodada anterior no Chrome isolado; veja a tabela abaixo para o alcance exato e a tentativa de repetição após os últimos ajustes. No Reddit, fotos, galerias, GIFs publicados como vídeo e algumas fontes DASH podem ser detectados, mas ainda faltam downloads reais de vídeo.

Na web geral, o painel pode filtrar imagens por dimensões e mostrar candidatos de rede quando a resposta tem tipo ou extensão reconhecível. O botão de hover depende de o elemento ser identificado como imagem de conteúdo, passar pelo filtro de elegibilidade e permitir que o content script opere naquela página.

## Onde os arquivos ficam

O destino padrão fica memorizado entre páginas e reinicializações: escolha uma pasta no painel ou marque **Usar a pasta Downloads do navegador**. A preferência vale também para os botões rápidos de download. Com o auxiliar local, a pasta escolhida é salva em `~/Library/Application Support/Media Collector/destinations.json` e os arquivos ficam organizados por origem (`Instagram`, `X.com`, `Reddit` e `Web geral`). Se o auxiliar ficar indisponível, uma pasta personalizada memorizada não será desviada silenciosamente para Downloads; o painel informará o problema. **Salvar seleção em…** continua sendo uma escolha pontual para aquela fila.

Os nomes incluem dados disponíveis da origem, como perfil, domínio, tipo e identificador da publicação. Títulos e parâmetros temporários da URL não são necessários para reconstruir o nome. Colisões recebem sufixos para evitar sobrescrever arquivos existentes.

## Formatos e limites técnicos

- O formato rápido padrão é MP4. O painel oferece outras opções quando o tipo e o processamento permitem.
- HLS/DASH só é processado quando o manifesto, os segmentos e as faixas podem ser identificados e baixados sem proteção. Vídeo e áudio separados podem ser reunidos quando o parser encontra ambas as faixas.
- Players MSE e `blob:` não são URLs de arquivo. A extensão pode observar fragmentos temporários em alguns players; a captura depende de a observação começar a tempo, de haver dados suficientes e de o vídeo e o áudio serem verificáveis.
- Um vídeo pode estar visível e ainda assim não ter uma fonte salvável. Arquivos incompletos, apenas thumbnails, segmentos isolados, fontes ambíguas ou protegidas devem ser informados como indisponíveis em vez de serem apresentados como vídeo concluído.
- O auxiliar usa ferramentas do sistema para algumas análises e downloads de página. Essas ferramentas e a extensão acessam o site/CDN necessário para buscar a mídia; “local” significa que o projeto não encaminha o conteúdo por um servidor próprio.

## Permissões

O manifesto solicita acesso amplo a páginas HTTP e HTTPS para inspecionar mídia, observar respostas de rede e inserir controles nos sites. Isso dá à extensão acesso ao conteúdo das páginas visitadas enquanto estiver habilitada. O acesso a `file://` não é concedido.

| Permissão | Finalidade no projeto |
| --- | --- |
| `scripting` | Inspecionar a aba e quadros acessíveis quando o usuário atualiza ou analisa a página. |
| `downloads` | Criar e acompanhar downloads do navegador. |
| `contextMenus` | Oferecer atalhos de download no menu contextual. |
| `storage` | Guardar preferências, fila, histórico local e observações temporárias de mídia. |
| `webRequest` | Observar metadados de respostas HTTP para reconhecer candidatos de mídia. O código não precisa ler cookies para essa observação. |
| `offscreen` | Processar operações que não podem rodar diretamente no service worker. |
| `sidePanel` | Exibir o painel lateral do Media Collector. |
| `nativeMessaging` | Comunicar-se com o auxiliar opcional instalado pelo usuário. |
| Hosts `http://*/*`, `https://*/*` | Executar os detectores e observar recursos em sites e CDNs. |
| Opcionais `notifications`, `downloads.open` | Notificar conclusão ou abrir um arquivo quando o usuário habilitar esses recursos. |

O navegador permite restringir o acesso a sites específicos. Essa restrição pode impedir detecção em páginas ou CDNs não autorizados. Revise as permissões na página de extensões antes de habilitar o projeto.

## Privacidade

- Não há conta, servidor de extração, analytics ou telemetria implementados pelo projeto.
- Preferências e histórico ficam no armazenamento local do navegador; buffers de mídia são temporários e usados para a captura selecionada.
- O Media Collector não pede senha nem exporta cookies. Downloads diretos podem depender da sessão que já está aberta no navegador.
- O auxiliar local não usa `--cookies-from-browser`; recursos que exigem autenticação podem falhar nele mesmo quando aparecem no navegador.
- As requisições necessárias para carregar a página e a mídia continuam indo ao site/CDN correspondente.

## Desenvolvimento e testes

Não é necessário instalar pacotes npm para executar os testes incluídos:

```sh
node --test testes/*.test.js
python3 -B -m unittest discover -s testes -p '*_test.py'
```

Para reconstruir o parser de streaming com a árvore travada, use `npm ci` e `npm run build:streams`. O lockfile também permite repetir a auditoria de dependências com `npm audit`.

Os testes automatizados exercitam lógica e integrações simuladas. Eles não substituem a validação ao vivo em cada site. Para desenvolvimento, carregue a pasta sem compactação no Brave ou Chrome e use páginas de teste que você controla.

## Validação e limites conhecidos

Em 23/11/2026, a suíte completa passou com **141 testes JavaScript e 33 testes Python**; também passaram `node --check` em todos os arquivos JavaScript, análise sintática dos arquivos Python e `git diff --check`. O teste novo de carrossel cobre a coleta direta de duas imagens-filhas já presentes no DOM sem avançar o slide. Os testes da fronteira de rede cobrem IP público fixado, DNS misto, redirects privados, proxy autenticado, conexão HTTP/HTTPS simulada e configuração do `yt-dlp`. Smokes anteriores com `yt-dlp` 2026.06.09 bloquearam loopback por HTTP e CONNECT HTTPS; acesso HTTPS público passou pelo proxy e por conexão direta. O alvo privado não recebeu conexão. Estes testes não substituem validação em sites reais.

| Área | Evidência registrada | Limite atual |
| --- | --- | --- |
| Web aberta | Em smoke anterior no Brave isolado, um SVG e um MP4 de teste foram salvos; hash e `ffprobe` confirmaram o arquivo. Nesta rodada, o painel reconheceu uma imagem SVG 1200 × 1200 e um MP4 de teste 640 × 640, 3 s; o botão de hover apareceu. O clique pôs a imagem na fila, mas o Brave headless encerrou o download com `USER_CANCELED`; nenhum arquivo foi contado como salvo nesta rodada. | Teste controlado de HTML direto. Não cobre amostra representativa, iframes cross-origin, HLS/DASH público, faixas separadas em player real ou fontes em APIs próprias. O smoke de vídeo salvo é histórico; a gravação por hover ainda precisa ser repetida em sessão interativa. |
| X | Dois posts públicos foram baixados em rodada anterior no Chrome isolado. Em outro comparativo, um post do Plucker gerou o mesmo MP4 por SHA-256 do Media Collector e outro foi baixado apenas pelo Media Collector. | Nesta rodada, `x.com/NASA` terminou em página de erro do navegador no Brave isolado. Não houve verificação de mídia nem download na revisão atual. Os sucessos anteriores são históricos e não validam o bridge atual. |
| Instagram | Testes automatizados cobrem associação MSE no feed, vídeos em slides diferentes, eviction, expiração e troca de `blob:`. Um teste confirma que duas mídias-filhas já expostas são recolhidas sem avançar slides. Nesta rodada, o perfil público NASA abriu sem autenticação; a aba Reels mostrou thumbnails e a publicação aberta expôs um `<video>` não protegido de 720 × 1280, com dois controles do coletor. | O teste ao vivo confirmou exposição do elemento e presença dos controles, mas não baixou o arquivo. O link aberto redirecionou para uma publicação colaborativa. Stories, feed com vídeo e carrossel real ainda não tiveram download validado. A coleta direta do carrossel só funciona se o site já tiver renderizado as mídias-filhas; caso contrário, usa o fallback visual. |
| Reddit | Testes simulados cobrem resolução de fontes e um manifesto DASH sintético. | Nesta rodada, a página nova mostrou desafio anti-bot e `old.reddit.com` redirecionou para login. Nenhum post ou arquivo de mídia ficou acessível; vídeo, áudio, GIF e galerias continuam sem validação ao vivo. |
| Native Messaging | No Brave 158 isolado, uma fila de teste percorreu o worker e `native-stream.js`; o auxiliar publicou um MP4 fixture em destino temporário. SHA-256 coincidiu com a origem, e `ffprobe` confirmou H.264/AAC por 2 s. | A fixture veio de `127.0.0.1` e foi rotulada `x.com` apenas para acionar o ramo de stream; não é teste do X real nem de escolha de pasta pela interface. O fluxo `chrome.downloads.download` recebeu HTTP 200, mas o Brave headless marcou `USER_CANCELED`; não houve chamada à API de cancelamento pela extensão. Reproduzir em ambiente interativo. |
| Destino | A preferência para uma pasta temporária de QA continuou exibida após reiniciar o Brave isolado. | A persistência foi conferida no armazenamento e no painel, não após escolher novamente a pasta pelo seletor nem após uma gravação real na pasta escolhida nesta rodada. |
| Chrome | — | No Chrome 158, os lançamentos desta rodada com perfil temporário não registraram a extensão via `--load-extension`; portanto, não validaram a revisão 5.0.1 no Chrome. Nenhum perfil pessoal foi usado. Carregamento manual sem compactação permanece pendente. |
| Permissões e privacidade | Manifesto e caminhos principais foram inspecionados estaticamente; não há APIs de cookies/histórico/cache. O auxiliar exige IP global para downloads HTTP(S), fixa o endereço validado na conexão direta e usa proxy local autenticado por tarefa no fluxo `yt-dlp`. O host registrado foi atualizado e recusou uma análise de URL loopback. | A barreira foi testada por unit tests e smoke test local de HTTP/CONNECT; não é firewall do sistema nem validação de todo protocolo ou plugin possível. Nenhuma conexão foi feita ao destino privado de fixture. |

Quando uma mídia falhar, registre apenas o site, o formato observado, o estado do player e a mensagem de erro. Não publique cookies, tokens, URLs assinadas, conteúdo privado ou arquivos baixados.

## Licença

O código original do Media Collector é oferecido sob MIT; consulte [`LICENSE`](LICENSE). Componentes de terceiros incluídos mantêm suas próprias licenças e avisos em [`LICENCAS/`](LICENCAS/):

| Componente incluído | Versão registrada | Licença |
| --- | --- | --- |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT |
| `@ffmpeg/core` (WebAssembly) | 0.12.10 | GPL-2.0-or-later |
| `@ffmpeg/types` | 0.12.4 | MIT |
| `m3u8-parser` | 7.2.0 | Apache-2.0 |
| `mpd-parser` | 1.3.1 | Apache-2.0 |
| `@xmldom/xmldom` | 0.8.15 | MIT |
| Transitive e build (`@babel/runtime`, `@videojs/vhs-utils`, `global`, `dom-walk`, `min-document`, `process`, `esbuild`) | Consulte `package-lock.json` e `LICENCAS/LEIA-ME.txt` | MIT |

O wrapper `@ffmpeg/ffmpeg` está sob MIT, mas o núcleo WebAssembly segue a licença do FFmpeg e das bibliotecas compiladas nele. Portanto, o repositório **não** declara que todos os componentes incorporados são exclusivamente MIT. Consulte os termos de cada dependência antes de redistribuir uma build combinada. Veja também a [documentação oficial de licenças do ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/faq.md).

## Segurança

Não inclua cookies, senhas, URLs assinadas ou amostras privadas em issues. Veja [`SECURITY.md`](SECURITY.md) para permissões e limites, e [`DEPENDENCY_AUDIT.md`](DEPENDENCY_AUDIT.md) para o resultado da auditoria npm e seus componentes fora de escopo.
