# TitanForge Launcher — código-fonte patcheado

Este repositório contém o JS já compilado/patchado (extraído do `app.asar`) usado para
gerar os instaladores do TitanForge Launcher. Duas variantes:

- `dev/` — build interna, mantém o seletor "Acesso Supabase / Acesso Servidor" na tela
  de login e o feed de atualização aponta pro caminho antigo do Umbra, pra acompanhar
  as atualizações originais antes de portar pro TitanForge.
- `cliente/` — build que vai pros clientes finais. Sem o seletor de backend (sempre
  usa Supabase), feed de atualização aponta pro caminho próprio do TitanForge.

## O que NÃO está aqui
- `node_modules`, os `.exe` gerados e os certificados/credenciais (`.p12`, `TitanForge.txt`)
  ficam de fora de propósito — nada disso deve ir pro Git.

## Principais mudanças recentes
- Licença: nova permissão `emuladores` (schema TitanForge Supabase).
- Novo módulo "Retro Anvil": download sob demanda do pacote de emuladores (RetroBat,
  sem ROMs), scan de pasta pra organizar jogos que o usuário já possui, capa buscada
  via libretro-thumbnails.
- Nav "+18" e "Retro Anvil" somem completamente do menu se a licença não tiver a
  permissão (em vez de aparecer bloqueado).
- "Adicionar Jogo" liberado pra todo mundo (sem paywall); jogos +18 continuam
  impossíveis de adicionar por esse caminho (catálogo já vem sem eles) e, se a busca
  bater com um jogo +18, avisa que precisa comprar a licença e redireciona pra Loja.
- Termos de uso: removida a menção à taxa de recuperação de licença; texto de troca/
  formatação de PC trocado por "entre em contato com o suporte".
