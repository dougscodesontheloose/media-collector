# Media Collector

Extensão experimental Manifest V3 para Chromium que ajuda a localizar e salvar fotos, vídeos e áudio que uma página já disponibiliza ao navegador. O processamento e o histórico são locais. O projeto não usa servidor próprio de extração, API oficial ou telemetria.

**Repositório:** <https://github.com/dougscodesontheloose/media-collector> · **Estado:** linha 5.0.0 em desenvolvimento. A cobertura varia por site e formato; consulte [validação atual](#validação-e-limites-conhecidos).

Use a extensão somente com conteúdo que você tenha direito de salvar e respeite as regras e permissões do site. Ela não contorna DRM, paywalls ou controles de acesso.

## O que faz

- Procura imagens e players na página aberta, inclusive em páginas dinâmicas e em quadros que o navegador permita inspecionar.
- Mostra controles discretos sobre imagens elegíveis e atalhos em publicações suportadas de Instagram, X e Reddit.
- Mantém um painel lateral para revisar candidatos, selecionar itens, acompanhar a fila e consultar falhas.
- Identifica arquivos diretos e tenta processar manifestos HLS e DASH sob demanda, quando não criptografados e quando os dados disponíveis bastam para reconstruí-los.
- Observa tráfego de mídia reconhecível e, por ação do usuário, pode tentar capturas temporárias de players MSE compatíveis.
- Salva os arquivos localmente, com destino configurável. O auxiliar nativo opcional permite escolher uma pasta e analisar páginas usando ferramentas instaladas no computador.

Esses recursos não garantem a captura de todos os itens de um perfil ou site. Links temporários, players fechados, formatos incompatíveis, expiração de URLs, conteúdo protegido e mudanças nas páginas podem impedir a detecção ou o download.

## Instalar no Chrome ou Comet

1. Baixe o código pelo botão **Code → Download ZIP** ou clone o repositório:

   ```sh
   git clone https://github.com/dougscodesontheloose/media-collector.git
   cd media-collector
   ```

2. Abra `chrome://extensions/` no Chrome ou `comet://extensions/` no Comet.
3. Ative **Modo do desenvolvedor** e selecione **Carregar sem compactação**.
4. Escolha a pasta que contém `manifest.json`.
5. Fixe o ícone da extensão, abra o painel e recarregue as abas que já estavam abertas.

Para atualizar uma instalação clonada, execute `git pull` na pasta e use **Recarregar** na página de extensões. Recarregue também as páginas do navegador para atualizar os content scripts.

## Auxiliar nativo opcional no macOS

Sem o auxiliar, os downloads usam o mecanismo do navegador. O auxiliar local é necessário para alguns destinos personalizados, processamento adicional e análise de páginas com `yt-dlp`. Ele é opcional e não recebe cookies exportados pelo Media Collector. A análise com `yt-dlp` depende de fontes acessíveis pelas ferramentas instaladas; não promete compatibilidade universal.

Instale `yt-dlp`, `ffmpeg` e `ffprobe` no sistema e confirme que os executáveis estão no `PATH` ou nos diretórios conhecidos pelo auxiliar. Com a extensão carregada, copie o ID exibido na página de extensões e registre o host:

```sh
python3 native/install.py --browser chrome --extension-id SEU_ID_DA_EXTENSAO
# ou
python3 native/install.py --browser comet --extension-id SEU_ID_DA_EXTENSAO
```

O instalador registra o host em `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. O Chrome e o Comet no macOS usam esse diretório. A extensão pode precisar ser recarregada depois do registro.

## Uso

1. Abra a página que contém a mídia.
2. Para uma imagem, passe o mouse sobre uma imagem elegível e clique no botão discreto; também é possível focá-lo pelo teclado.
3. Para uma publicação suportada, use o botão junto aos controles da publicação. Em carrosséis, o atalho tenta percorrer os itens carregáveis.
4. Abra o painel para atualizar a lista, escolher mídias, definir formato, pasta e acompanhar a fila.
5. Confira o estado final do item. Uma notificação de fila iniciada não significa que o arquivo foi salvo.

No Instagram, os atalhos podem aparecer em publicações, Reels e Stories acessíveis na sessão; Stories/Reels podem usar buffers temporários do player. No X, o atalho tenta associar uma variante de vídeo à publicação atual. No Reddit, fotos, galerias, GIFs publicados como vídeo e algumas fontes DASH podem ser detectados. A cobertura de vídeo dessas plataformas ainda está em validação.

Na web geral, o painel pode filtrar imagens por dimensões e mostrar candidatos de rede quando a resposta tem tipo ou extensão reconhecível. O botão de hover depende de o elemento ser identificado como imagem de conteúdo, passar pelo filtro de elegibilidade e permitir que o content script opere naquela página.

## Onde os arquivos ficam

O destino padrão do auxiliar é `~/Documents/Media Collector/Mídias`, separado em pastas de origem como `Instagram`, `X.com`, `Reddit` e `Web geral`. O painel permite escolher outra pasta. Sem o auxiliar, o navegador salva na pasta configurada em seus próprios downloads; a opção **Salvar em…** pode pedir um destino para cada item.

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
python3 -B testes/native_destination_test.py
```

Os testes automatizados exercitam lógica e integrações simuladas. Eles não substituem a validação ao vivo em cada site. Para desenvolvimento, carregue a pasta sem compactação no Chrome/Comet e use páginas de teste que você controla.

## Validação e limites conhecidos

Última verificação automatizada desta árvore: **22/11/2026 — 96 testes JavaScript e 19 testes Python aprovados**.

| Área | Evidência registrada | Limite atual |
| --- | --- | --- |
| Web aberta | Player público de exemplo do MDN e fixtures locais de mídia foram usados para validar downloads e inspecionar faixas/duração em um fluxo controlado. | Isso não cobre uma amostra representativa de players, iframes cross-origin, HLS/DASH público ou sites que escondem fontes em APIs próprias. |
| X | Dois posts de teste tiveram download de vídeo observado em um snapshot anterior. | O fluxo ainda precisa ser repetido na árvore exata deste repositório; algumas publicações podem expor somente a capa ou fontes temporárias. |
| Instagram | Há testes automatizados de associação e captura temporária. | Reels, Stories e vídeos do feed ainda não têm validação ao vivo completa; não declarar a captura de vídeo estável. |
| Reddit | Os testes simulados cobrem resolução de fontes e um manifesto DASH sintético. | Falta validar o arquivo final com vídeo, áudio e duração em publicação real; iframes e alguns formatos podem não ser reconhecidos. |
| Permissões e privacidade | Manifesto e caminhos principais foram inspecionados estaticamente. | Não é uma auditoria independente de segurança nem uma captura exaustiva de tráfego em todos os fluxos. O auxiliar nativo deve ser revisado antes de uso amplo. |

Quando uma mídia falhar, registre apenas o site, o formato observado, o estado do player e a mensagem de erro. Não publique cookies, tokens, URLs assinadas, conteúdo privado ou arquivos baixados.

## Licença

O código original do Media Collector é oferecido sob MIT; consulte [`LICENSE`](LICENSE). Componentes de terceiros incluídos mantêm suas próprias licenças e avisos em [`LICENCAS/`](LICENCAS/):

| Componente incluído | Versão registrada | Licença |
| --- | --- | --- |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT |
| `@ffmpeg/core` (WebAssembly) | 0.12.10 | GPL-2.0-or-later |
| `m3u8-parser` | 7.2.0 | Apache-2.0 |
| `mpd-parser` | 1.3.1 | Apache-2.0 |
| `@babel/runtime`, `@videojs/vhs-utils`, `global`, `@xmldom/xmldom` | Consulte `LICENCAS/LEIA-ME.txt` | MIT |

O wrapper `@ffmpeg/ffmpeg` está sob MIT, mas o núcleo WebAssembly segue a licença do FFmpeg e das bibliotecas compiladas nele. Portanto, o repositório **não** declara que todos os componentes incorporados são exclusivamente MIT. Consulte os termos de cada dependência antes de redistribuir uma build combinada. Veja também a [documentação oficial de licenças do ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/faq.md).

## Segurança

Não inclua cookies, senhas, URLs assinadas ou amostras privadas em issues. O auxiliar nativo é experimental: no estado atual, o caminho de análise com `yt-dlp` ainda não bloqueia redirecionamentos para endereços privados ou locais. Evite usá-lo para analisar páginas não confiáveis em redes com serviços internos até que esse controle seja implementado. Consulte [`SECURITY.md`](SECURITY.md) para relatar outros problemas.
