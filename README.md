# Media Collector

Extensão experimental Manifest V3 para Chromium que ajuda a localizar e salvar fotos, vídeos e áudio que uma página já disponibiliza ao navegador. O processamento e o histórico são locais. O projeto não inclui telemetria, analytics, rastreamento, coleta remota de dados ou serviço externo de extração.

**Repositório:** <https://github.com/dougscodesontheloose/media-collector> · **Versão:** 5.3.0 · **Estado:** candidata experimental; a cobertura varia por site e formato. Consulte a [especificação funcional](#especificação-funcional-consolidada) e a [validação atual](#validação-e-limites-conhecidos).

Use a extensão somente com conteúdo que você tenha direito de salvar e respeite as regras e permissões do site. Ela não contorna DRM, paywalls ou controles de acesso.

## O que faz

- Procura imagens e players na página aberta, inclusive em páginas dinâmicas e em quadros que o navegador permita inspecionar.
- Mostra controles discretos sobre imagens elegíveis e atalhos em publicações suportadas de Instagram, X e Reddit.
- Em carrosséis do Instagram, tenta enfileirar de uma vez as imagens e vídeos-filhos grandes já renderizados no post. Se o site ainda só tiver carregado o slide atual, mantém o avanço visual como fallback.
- Mantém um painel lateral para revisar candidatos, selecionar itens, acompanhar a fila e consultar falhas.
- Identifica arquivos diretos e tenta processar manifestos HLS e DASH sob demanda, quando não criptografados e quando os dados disponíveis bastam para reconstruí-los.
- Observa tráfego de mídia reconhecível e, por ação do usuário, pode tentar capturas temporárias de players MSE compatíveis.
- Salva os arquivos localmente, com destino configurável e persistente. Com o auxiliar nativo, a pasta escolhida recebe os arquivos diretamente sem depender da preferência global “Perguntar onde salvar” do navegador; se a fonte não puder ser buscada localmente, a fila pede uma decisão antes de tentar pelo navegador.

Esses recursos não garantem a captura de todos os itens de um perfil ou site. Links temporários, players fechados, formatos incompatíveis, expiração de URLs, conteúdo protegido e mudanças nas páginas podem impedir a detecção ou o download.


## Privacidade e comunicação de rede

Privacidade é um requisito do projeto. O Media Collector não tem conta, servidor do projeto, backend de extração, analytics, telemetria, rastreamento nem relatório de falhas remoto. Não envia URLs visitadas, histórico, conteúdo das páginas, nomes de arquivos, preferências ou resultados de downloads a serviços de métricas, diagnóstico ou extração. O código executável necessário à extensão é empacotado localmente; ela não baixa código remoto.

Preferências, fila, histórico e observações temporárias ficam no armazenamento local do navegador. A extensão não pede senha, não usa a API de cookies e não exporta cookies, histórico ou cache. O auxiliar opcional também não importa cookies do navegador. A sessão que já está aberta pode ser usada pelo próprio navegador para carregar a página e, quando possível, baixar a mídia selecionada.

**Limite de rede:** abrir páginas e buscar a mídia exige comunicação com o site que a publica e com os servidores/CDNs que a hospedam. O auxiliar local e ferramentas que você instalar, como `yt-dlp`, também podem fazer requisições diretamente a esses hosts. Eles recebem os metadados normais dessas requisições, como endereço IP e cabeçalhos HTTP, e podem manter seus próprios registros conforme as políticas deles. Esse tráfego é necessário para acessar a origem; o Media Collector não o encaminha por um servidor próprio nem o usa para telemetria.

A versão 5.3.0 é uma candidata experimental e inclui ajustes no destino persistente e no fallback de downloads diretos. A cobertura varia por site e formato; a ausência de telemetria deve continuar sendo conferida em revisões futuras de código e dependências.

## Especificação funcional consolidada

Esta seção registra o que o Media Collector **deve fazer** para orientar auditorias, correções e versões futuras. Ela consolida os objetivos do produto e as decisões de arquitetura; não afirma que todas as capacidades já estejam implementadas ou validadas. O estado real por cenário fica em [Validação e limites conhecidos](#validação-e-limites-conhecidos).

### Requisitos de experiência e navegação

- **UX-01 — Ação contextual sem interferência:** a extensão não deve cobrir controles, deslocar conteúdo, capturar eventos da página ou colocar um botão sobre cada elemento visual encontrado. A lista do painel é o lugar para candidatos ambíguos e inspeção em lote.
- **UX-02 — Atalho de hover seletivo:** exibir um botão pequeno, discreto e acessível por teclado somente quando o ponteiro estiver sobre mídia elegível e baixável. Respeitar a opção de desligar o hover para o site atual. Sem filtro dimensional ativo, imagens precisam ter ao menos 600 × 600 px para receber o atalho; com o filtro ativo, o limiar segue o slider. Players de vídeo precisam ter dimensões verificadas acima de 500 × 500 px.
- **UX-03 — Miniaturas:** capas de vídeos do YouTube podem aparecer como candidatas revisáveis no painel, mesmo abaixo do limite dimensional, mas ficam fora do botão rápido e da coleta em lote de imagens da página. Poster, thumbnail, avatar, logo, ícone, seta, indicador, botão e outro elemento de interface não podem ser confundidos com o arquivo de vídeo ou com uma imagem editorial baixável. Se não houver associação confiável, deixar a pessoa revisar o candidato no painel.
- **UX-04 — Filtro dimensional ajustável:** oferecer slider de tamanho mínimo de imagem com as opções **100, 200, 400, 600, 800, 1000 e acima de 1000 px**, aplicadas às dimensões reais verificadas da imagem. Áudio não usa filtro de dimensão. A lista lateral pode mostrar candidatos menores quando o filtro estiver desligado; isso não autoriza o atalho rápido a cobrir miniaturas.
- **UX-05 — Atualização da aba:** disponibilizar ação para atualizar a coleta da aba ativa após navegação comum ou SPA, sem exigir reinstalar ou reabrir a extensão.
- **UX-06 — Adaptação visual:** integrar os controles ao site, sem substituir o desenho do site. No Instagram, usar o controle discreto off-white com símbolo vermelho; no X, manter o atalho que já se integra à barra de ações e adaptar a apresentação conforme o domínio.
- **UX-07 — Estado compreensível:** distinguir encontrado, verificando, na fila, baixando, processando, pausado, salvo, incompleto e falhou. Uma fila iniciada ou um arquivo criado não bastam para declarar sucesso.

### Requisitos da web aberta

- **WEB-01 — Página variável:** adaptar a coleta ao que a página realmente expõe, sem presumir uma estrutura única de site. O painel deve permitir atualizar e revisar os candidatos encontrados.
- **WEB-02 — Imagens:** identificar `<img>`, `<picture>`, `srcset`, lazy loading e imagens de fundo quando o navegador e a página permitirem; apresentar resoluções alternativas quando verificáveis; deduplicar a mesma origem. Não prometer acesso a fontes que a página não disponibiliza.
- **WEB-03 — Players:** procurar fontes diretas de `<video>`/`<audio>`, `<source>`, metadados e respostas de mídia observáveis. Considerar iframes e Shadow DOM aberto quando houver permissão e associação segura. A inspeção de rede deve gerar candidatos revisáveis, não baixar automaticamente todo recurso da página.
- **WEB-04 — Formatos de vídeo e áudio:** reconhecer arquivos diretos e tentar HLS/DASH quando manifestos, segmentos e trilhas estiverem completos e sem proteção. Lidar com vídeo e áudio separados, respostas parciais e ranges apenas quando for possível validar ordem, cobertura e integridade. `blob:`/MSE só podem ser processados em fluxos suportados, com ação explícita do usuário e buffer suficiente.
- **WEB-05 — Formato final:** MP4 é o padrão dos atalhos rápidos. O painel pode oferecer MP4, WebM, original e formatos de áudio. Só converter quando o processamento local realmente produzir o contêiner e codec escolhidos; nunca renomear bytes incompatíveis para aparentar MP4. Se não for possível converter, informar e preservar o original quando viável.
- **WEB-06 — Limites honestos:** a presença de um player não garante uma fonte salvável. DRM, fontes criptografadas, autenticação que o processo local não possui, URLs expiradas, segmentos ausentes, CORS, quadros inacessíveis e codecs incompatíveis devem produzir um motivo claro. Não contornar DRM, paywall ou controle de acesso.

### Adaptadores sociais

- **IG-01 — Ações individuais:** permitir baixar a foto, vídeo, Reel ou Story atual que esteja acessível na sessão. O Story deve ser associado ao conteúdo exibido, inclusive na troca entre Stories; se ele apenas compartilhar um Reel, o atalho tenta salvar o Story exibido e não promete baixar o Reel completo.
- **IG-02 — Carrossel:** oferecer download de todos os itens do post num único acionamento e também a opção individual por item. Primeiro coletar filhos já renderizados e associados ao post; usar navegação visual como fallback apenas quando necessário. Não percorrer slide por slide se todos os itens já estão disponíveis no DOM.
- **IG-03 — Perfil e feed:** oferecer “Baixar tudo” no perfil e “Baixar posts carregados” no feed, incluindo fotos e vídeos acessíveis, sem filtro de tipo para a ação de tudo. Percorrer apenas conteúdo que a página consiga carregar com a sessão aberta; permitir limite configurável, progresso, pausa, retomada e cancelamento; reportar itens ignorados e coleta parcial. Nunca declarar perfil completo se a rolagem foi interrompida, se a página parou de carregar ou se houve falhas.
- **X-01 — Ação no post:** oferecer um botão discreto na área de ações do post, associado ao post atualmente exibido. Baixar imagem, GIF ou vídeo correspondente; ao escolher vídeo, não entregar apenas o poster.
- **X-02 — Variantes e timeline:** selecionar uma variante de vídeo verificável, não misturar mídia de posts pré-carregados e atualizar a associação em navegação SPA. Se a origem direta não puder ser determinada, apresentar a fonte no painel para verificação.
- **RED-01 — Publicações:** oferecer ações para fotos, galerias, GIFs e vídeos do Reddit, associados ao post atual.
- **RED-02 — Vídeo e áudio:** quando vídeo e áudio forem trilhas separadas (por exemplo, DASH), combiná-los localmente apenas se as trilhas forem completas e sincronizáveis; validar o arquivo final, não apenas a conclusão da fila.

### Fila, destino e nomes

- **DL-01 — Controle da fila:** seleção individual ou em lote, progresso de descoberta e download, pausa/retomada, cancelamento, nova tentativa, deduplicação e mensagens específicas por item. Não chamar uma coleta parcial de completa.
- **DL-02 — Pastas simples:** agrupar tudo em `Media Collector/Instagram`, `Media Collector/X.com`, `Media Collector/Reddit` ou `Media Collector/Web geral`. Não criar subpastas por perfil, post, Story, Reel ou tipo de mídia; não criar arquivos `.txt` com URLs.
- **DL-03 — Destino escolhido:** permitir configurar uma pasta padrão persistente, usar a pasta Downloads do navegador ou selecionar outro destino para uma fila específica, quando o ambiente e o auxiliar local derem suporte. Informar se um modo não está disponível; não redirecionar silenciosamente para outra pasta.
- **DL-04 — Nomes úteis:** usar o perfil/autor quando conhecido, origem e identificador estável de post/mídia/posição quando disponíveis. Evitar nomes genéricos como `Mídia 1`; remover parâmetros assinados e segredos do nome; resolver colisões sem sobrescrever arquivos.
- **DL-05 — Confirmação:** conferir tipo, dimensões, duração, presença de áudio e integridade quando os dados forem acessíveis. Mostrar arquivo/pasta e estado real depois do download.

### Privacidade e limites de acesso

- **PRIV-01:** processar e manter estado no dispositivo sempre que possível; não usar servidor próprio de extração, telemetria ou código remoto.
- **PRIV-02:** não pedir senha, ler/exportar cookies pela API de cookies nem coletar histórico/cache do navegador. Algumas requisições feitas pela extensão podem usar a sessão já aberta; isso deve ser declarado, limitado à obtenção da mídia escolhida e nunca registrado em relatórios. O auxiliar `yt-dlp` não recebe cookies exportados.
- **PRIV-03:** solicitar somente as permissões necessárias e explicar as permissões amplas de host no [guia de segurança](SECURITY.md). O acesso a conteúdo autenticado deve continuar sujeito à sessão, disponibilidade e regras do próprio serviço; não usar endpoints privados ou APIs não autorizadas para contornar essas barreiras.
- **PRIV-04:** manter auxiliar, `yt-dlp` e FFmpeg opcionais. Restringir destinos de rede e validar arquivos antes de publicar no destino. Não afirmar que o auxiliar elimina todos os limites de segurança ou compatibilidade.

### Critérios de aceite para auditorias futuras

Uma capacidade só deve ser marcada **Validada** quando testada na versão identificada, com o resultado observado e artefato verificado quando aplicável. A suíte simulada é evidência de lógica, não prova de compatibilidade no site.

| Grupo | Cenários mínimos para fechar a validação |
| --- | --- |
| Web / hover | Imagem editorial grande, miniatura comum, capa do YouTube, logo/avatar, botão de interface, slider nos limiares, desligar hover por site e navegação sem sobreposição indevida; verificar que a miniatura do YouTube continua acessível no painel. |
| Web / vídeo | MP4/WebM direto; HLS; DASH com áudio separado; resposta parcial; `blob:`/MSE em player compatível; mudança de fonte; iframe acessível e inacessível; erro/expiração; validar codec, duração, áudio e integridade. |
| Instagram | Foto, carrossel com filhos já renderizados, carrossel com fallback, feed com vídeo, Reel, Story de foto, Story de vídeo e perfil interrompido/limitado; verificar associação e estado parcial. |
| X | Foto, GIF, vídeo com poster, vídeo antes/depois do play, mais de um post/player na tela e navegação SPA; comparar arquivos de mesmo post sem presumir equivalência interna. |
| Reddit | Foto, galeria, GIF servido como vídeo, DASH com áudio separado, erro e post com várias mídias. |
| Fila e destino | Pasta personalizada, Downloads do navegador, nome, colisão, duplicata, pausa, retomada, cancelamento, falha parcial e recuperação; verificar bytes no destino final. |
| Privacidade | Revisar permissões, dependências, tráfego, logs, estado local, auxiliar e ausência de telemetria/código remoto; repetir testes de restrição de rede documentados em `SECURITY.md`. |

A validação prática desta rodada deve usar o perfil real do Chrome ou Brave que o usuário apontar, inclusive se estiver autenticado. Não criar perfis isolados. Resultados de sessões isoladas anteriores são somente evidência histórica; não substituem a validação no navegador escolhido para esta rodada.

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

Ao carregar outra pasta de build, o navegador pode atribuir um novo ID à extensão. Use esse ID no registro do auxiliar abaixo antes de testar destinos nativos; o instalador preserva os IDs já permitidos.

Para atualizar uma instalação clonada, execute `git pull` na pasta e use **Recarregar** na página de extensões. Recarregue também as páginas do navegador para atualizar os content scripts.

## Auxiliar nativo opcional no macOS

Sem o auxiliar, os downloads usam o mecanismo do navegador e podem obedecer à preferência global de perguntar onde salvar. O auxiliar local é necessário para gravar diretamente em uma pasta persistente sem abrir esse diálogo, para processamento adicional e para análise de páginas com `yt-dlp`. Ele é opcional e não recebe cookies exportados pelo Media Collector. A análise com `yt-dlp` depende de fontes acessíveis pelas ferramentas instaladas; não promete compatibilidade universal.

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

Na web geral, o painel pode filtrar imagens por dimensões e mostrar candidatos de rede quando a resposta tem tipo ou extensão reconhecível. Sem filtro dimensional ativo, o botão rápido exige uma imagem de pelo menos 600 × 600 px; quando o filtro é ativado, segue o slider. Capas de vídeos do YouTube ficam no painel e não recebem botão rápido.

## Onde os arquivos ficam

O destino escolhido fica memorizado entre páginas e reinicializações: use **Escolher pasta para os downloads** para selecionar uma pasta ou marque **Salvar diretamente em Downloads (~/Downloads)**. A preferência também vale para botões rápidos. Com o auxiliar local registrado para o ID atual da extensão, os arquivos são gravados diretamente no destino persistente, sem passar pela caixa “Salvar como” do navegador; a configuração das pastas fica em `~/Library/Application Support/Media Collector/destinations.json`, e os arquivos continuam organizados por origem (`Instagram`, `X.com`, `Reddit` e `Web geral`). Se o auxiliar não puder buscar uma fonte, a fila pausa e oferece **Baixar pelo navegador** ou **Ignorar este item**. A tentativa pelo navegador é sempre iniciada após esse clique e pode abrir o diálogo do sistema. Se o auxiliar ficar indisponível, a pasta memorizada não é desviada silenciosamente para outra pasta. **Salvar seleção em…** continua sendo uma escolha pontual para aquela fila.

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

## Desenvolvimento e testes

Não é necessário instalar pacotes npm para executar os testes incluídos:

```sh
node --test testes/*.test.js
python3 -B -m unittest discover -s testes -p '*_test.py'
```

Para reconstruir o parser de streaming com a árvore travada, use `npm ci` e `npm run build:streams`. O lockfile também permite repetir a auditoria de dependências com `npm audit`.

Os testes automatizados exercitam lógica e integrações simuladas. Eles não substituem a validação ao vivo em cada site. Para esta rodada, a validação de interface deve ocorrer no Chrome, em uma janela/perfil indicado pelo usuário, sem criar perfil isolado.

## Validação e limites conhecidos

Em 23/11/2026, a suíte completa passou com **143 testes JavaScript e 33 testes Python**. Em 24/11/2026, na árvore local 5.3.0, passaram **146 testes JavaScript e 35 testes Python**; também passaram `node --check` nos arquivos JavaScript, análise sintática Python e validação JSON do manifest e pacotes. Os testes adicionados cobrem Downloads persistente, gravação de MP4/imagem via destino nativo e fallback explícito. O teste de carrossel cobre a coleta direta de imagens-filhas já presentes no DOM sem avançar o slide. Os testes da fronteira de rede cobrem IP público fixado, DNS misto, redirects privados, proxy autenticado, conexão HTTP/HTTPS simulada e configuração do `yt-dlp`. Smokes anteriores com `yt-dlp` 2026.06.09 bloquearam loopback por HTTP e CONNECT HTTPS; acesso HTTPS público passou pelo proxy e por conexão direta. O alvo privado não recebeu conexão. Estes resultados simulados não substituem validação no Chrome ou em sites reais.

| Área | Evidência registrada | Limite atual |
| --- | --- | --- |
| Botão rápido / thumbnails | Na árvore 5.2.0, o padrão do hover exige 600 × 600 px quando o filtro está desligado; com o filtro ligado, usa o slider. Imagens de `ytimg.com` e fontes de vídeo encontradas dentro de cards/links de prévia do YouTube ficam fora do botão rápido e do lote automático; capas podem ser mostradas como candidatas revisáveis no painel, mesmo abaixo do slider. O player da página de reprodução não é excluído apenas por estar no YouTube. | É uma correção estática nos caminhos de hover e inventário. A captura que motivou a mudança ainda não foi repetida no Chrome 158; prévias que escondam a relação com o link do vídeo ou usem CDNs/contextos diferentes ainda precisam de validação. |
| Web aberta | Em teste histórico no Brave 158, com perfil isolado e interface gráfica, os botões de hover apareceram sobre uma imagem PNG 1200 × 1200 e um MP4 direto. A imagem foi salva no destino temporário personalizado; o SHA-256 coincidiu com a origem. O MP4 foi salvo integralmente; SHA-256 coincidiu, e `ffprobe` confirmou H.264 + AAC, 640 × 360 e 3 s. | Fixture HTTP controlada; não cobre amostra representativa, iframes cross-origin, HLS/DASH público, faixas separadas em player real ou fontes em APIs próprias. Não valida sites sociais. |
| X | Dois posts públicos foram baixados em rodada anterior no Chrome isolado. | Num teste histórico, `x.com/NASA` terminou em página de erro do navegador no Brave isolado. Não houve verificação de mídia nem download na revisão atual. Os sucessos anteriores são históricos e não validam o bridge atual. |
| Instagram | Testes automatizados cobrem associação MSE no feed, vídeos em slides diferentes, eviction, expiração e troca de `blob:`. Um teste confirma que duas mídias-filhas já expostas são recolhidas sem avançar slides. Nesta rodada, o perfil público NASA abriu sem autenticação; a aba Reels mostrou thumbnails e a publicação aberta expôs um `<video>` não protegido de 720 × 1280, com dois controles do coletor. | O teste ao vivo confirmou exposição do elemento e presença dos controles, mas não baixou o arquivo. O link aberto redirecionou para uma publicação colaborativa. Stories, feed com vídeo e carrossel real ainda não tiveram download validado. A coleta direta do carrossel só funciona se o site já tiver renderizado as mídias-filhas; caso contrário, usa o fallback visual. |
| Reddit | Testes simulados cobrem resolução de fontes e um manifesto DASH sintético. | Nesta rodada, a página nova mostrou desafio anti-bot e `old.reddit.com` redirecionou para login. Nenhum post ou arquivo de mídia ficou acessível; vídeo, áudio, GIF e galerias continuam sem validação ao vivo. |
| Native Messaging | Em teste histórico no Brave 158 isolado, uma fila percorreu o worker e `native-stream.js`; o auxiliar publicou um MP4 fixture em destino temporário. SHA-256 coincidiu com a origem, e `ffprobe` confirmou H.264/AAC por 2 s. | A fixture veio de `127.0.0.1` e foi rotulada `x.com` apenas para acionar o ramo de stream; não é teste do X real nem de escolha de pasta pela interface. O fluxo `chrome.downloads.download` recebeu HTTP 200, mas o Brave headless marcou `USER_CANCELED`; não houve chamada à API de cancelamento pela extensão. Reproduzir em ambiente interativo. |
| Destino | Em teste histórico no Brave 158 isolado, o painel mostrou a pasta temporária personalizada após fechar e reabrir o navegador. Um download de imagem foi publicado nessa pasta pelo auxiliar local e seu SHA-256 coincidiu com a fixture; a área temporária de estágio ficou vazia após a publicação. | O teste verificou persistência e escrita usando configuração temporária isolada. O seletor do sistema não confirmou a escolha de um caminho novo por interação completa; essa parte da usabilidade continua pendente. Nenhum arquivo de QA permaneceu na pasta real do usuário. |
| Destino 5.3.0 | Testes automatizados cobrem a persistência da seleção Downloads, escrita em pasta por Native Messaging, escolha explícita de fallback após falha de `fetch`, e ausência de chamadas automáticas a `chrome.downloads` nesse fallback. Validação de tipo de imagem confere assinatura básica e rejeita HTML. | Ainda não validado por interação na janela do Chrome: seleção de pasta personalizada, Downloads, preferência global “Perguntar onde salvar”, persistência após reinício e fallback real em site autenticado. Os testes automatizados não confirmam a experiência do diálogo do macOS nem substituem essa validação. |
| Navegador apontado pelo usuário | O usuário pediu concentrar a validação de interface no Chrome; builds anteriores tiveram testes isolados em Chrome e Brave. | A instalação e o fluxo de destino da versão local 5.3.0 ainda precisam ser confirmados na janela do Chrome. Nenhuma instalação ou download de mídia real foi feito nesta rodada. |
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
