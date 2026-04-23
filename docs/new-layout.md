# ATLAS Layout — Plano de Ação

Referência visual: screenshot + `.REFACTOR.md`
Referência de código: CLAUDE.md (arquitetura do projeto)

> Marcar cada parte como `[x]` assim que estiver pronta.

---

## Parte 1 — Tema ATLAS (cores base) `[x]`

**O que mudar:** `src/index.css` + `src/themes/index.ts`

O ATLAS usa uma paleta diferente da atual. Atualizar as CSS vars e o tema `pulsesql-dark`.

| Token      | Atual        | ATLAS        |
|------------|-------------|-------------|
| background | `#0B0F14`   | `#08111A`   |
| surface    | `#10171F`   | `#0D1824`   |
| border     | `#1D2A34`   | `#1A2C3C`   |
| primary    | `#2BD3C9`   | (não usado — cada conexão tem a sua cor) |
| text       | `#E6EDF3`   | `#EDF4FB`   |
| muted      | `#88A0AF`   | `#8AA3B6`   |

Body background: trocar o radial-gradient atual por fundo **flat** `#08111A` (o ambient wash virá via código, não CSS).

**Arquivos:** `src/index.css` (vars CSS) · `src/themes/index.ts` (objeto do tema `pulsesql-dark`)

---

## Parte 2 — Ambient connection wash `[x]`

**O que mudar:** `ConnectionManager.tsx` ou wrapper do workspace

Adicionar um `<div>` absoluto no topo do conteúdo principal com:
```
background: radial-gradient(ellipse 60% 100% at 20% 0%, {connectionColor}18, transparent 60%)
height: 160px
top: 0, left: 0, right: 0
pointer-events: none
z-index: 0
```
Muda de cor conforme a conexão ativa.

**Arquivos:** `src/features/connections/ConnectionManager.tsx`

---

## Parte 3 — Title bar `[x]`

**O que mudar:** Novo componente `TitleBar.tsx` inserido no topo do layout

O ATLAS tem uma barra de título de 38px (abaixo dos traffic lights do macOS — `padding-left: 76px`):

- **Logo**: ícone PulseSQL colorido com `connectionColor`
- **"PulseSQL"** em `font-weight: 700`
- **Breadcrumb**: dois pills colados:
  - Left pill: `[color dot 8px] [Connection Name]` — fundo `color+18`, borda `color+50`, sem borda direita
  - Right pill: `[schema] [▾]` — fundo `bgChip`, borda `border`
- **"● LIVE"** badge (dir): borda `color+40`, fundo `color+10`, texto `connectionColor`
- Borda inferior: `1px solid border`

**Arquivos:** `src/features/connections/TitleBar.tsx` (novo) · `src/features/connections/ConnectionManager.tsx` (inserir)

---

## Parte 4 — Sidebar redesign `[x]`

**O que mudar:** `ConnectionManager.tsx` — seção do sidebar

### 4a — Header da seção "CONNECTIONS"
Trocar "Explorer" pelo padrão ATLAS:
```
CONNECTIONS  ─────────────────  5
```
- Label `text-[10px] font-bold tracking uppercase letter-spacing-[1.6px]`
- Linha horizontal separadora
- Contagem de conexões (monospace, `textMute`)

### 4b — Itens de conexão
Cada item vira um `<div>` (já é `<button>` — manter) com:
- `margin: 0 8px 3px` · `padding: 9px 10px` · `borderRadius: 8px`
- Active: `background: color+12`, `border: 1px solid color+40`
- Inactive: background transparente
- **Left bar**: `width: 3, height: 26` (tamanho fixo, não full-height), `borderRadius: 2`
  - Active: glow `0 0 10px color`, opacidade 1
  - Inactive: opacidade 0.55, sem glow
- **Engine badge** (direita): pill colorido com `color` da conexão (texto + borda + fundo)
  - Mostrar `PG` para postgres, `ORA` para oracle, `MY` para mysql

### 4c — Seção Tables
Separador com `borderTop: 1px solid border` + label "TABLES"
Items com:
- Ícone `▦` (table) ou `◇` (view) — colorido com `textMute` / `activeColor`
- Nome em monospace
- Row count alinhado à direita em `textMute`

**Arquivos:** `src/features/connections/ConnectionManager.tsx`

---

## Parte 5 — Tab strip redesign `[x]`

**O que mudar:** `QueryWorkspace.tsx` — tab bar

O design atual usa `rounded-t-lg border-b-2` (borda inferior). O ATLAS usa **barra superior de 2px com glow**.

### Mudanças:
- Remover `rounded-t-lg` e `border-b-2` dos tabs
- Tab ativo: `background: bgElev` (sólido), borda inferior = `1px solid bgElev` (funde com toolbar)
- Tab inativo: background transparente, borda inferior = `1px solid border`
- **Indicador superior** (active only): `<div>` absoluto `top: 0, height: 2px, background: tabColor, boxShadow: 0 0 10px tabColor`
- Dot colorido: mantido (já existe)
- Tab strip container: `background: rgba(10,20,32,0.4)` (flat, sem `glass-panel` ou `rounded-lg`)
- Botão `+`: flush, sem borda, fundo none, `borderBottom: 1px solid border`, `flex: 1` para empurrar à direita

**Arquivos:** `src/features/query/QueryWorkspace.tsx`

---

## Parte 6 — Toolbar & Run button `[x]`

**O que mudar:** `QueryWorkspace.tsx` — barra de ferramentas

### Run button (mudança principal)
O ATLAS usa botão **sólido** — NÃO transparente/tintado:
```
background: connectionColor  (sólido, 100%)
color: '#001810'             (texto escuro sobre fundo brilhante)
boxShadow: 0 0 18px color+60, inset 0 1px 0 rgba(255,255,255,0.2)
```

Atualmente está: `bg-emerald-400/18 text-emerald-200` (versão antiga) → mudei para `hexToRgba(color, 0.18)` (ainda tintado). Precisa ser sólido.

### Outros botões
- **Explain**: `background: bgChip`, `color: text`, `border: 1px solid border`
- **Format**: transparente, `color: textDim`, `border: 1px solid border`
- Stats (dir): monospace, `textDim` — `23 L · 412 c` e `Ln 12, Col 8`

### Toolbar container
- `background: bgElev`
- `borderBottom: 1px solid border`
- Remover `glass-panel` do card que engloba tabs + toolbar

**Arquivos:** `src/features/query/QueryWorkspace.tsx`

---

## Parte 7 — Result tabs (pill style) `[x]`

**O que mudar:** `QueryWorkspace.tsx` — header da área de resultados

O atual usa `border-b-2` (underline). O ATLAS usa **pills dentro de um container**:

```
Container: background: bg, borderRadius: 7, border: 1px solid border, padding: 2
Active pill: background: color+20, color: activeColor, border: 1px solid color+40, borderRadius: 5
Inactive pill: background: none, color: textDim
```

Stats de execução ao lado:
- `✓ 10 / 194 rows` — checkmark e contagem coloridos com `connectionColor`
- `42 ms` — colorido com `connectionColor`
- Separador `│` em `textMute`

**Arquivos:** `src/features/query/QueryWorkspace.tsx`

---

## Parte 8 — Status bar redesign `[x]`

**O que mudar:** `ConnectionManager.tsx` — barra inferior

O ATLAS tem status bar **monospace + uppercase + letter-spacing** com estrutura:

```
[● ConnName] · [pg 15.4] · [14:22:08Z] · [10 rows · 42 ms]    [AUTOCOMMIT] · [v1.1.14]
```

- Background: `bg` (mais escuro que o atual `glass-panel`)
- Sem `glass-panel`, sem `rounded-lg`
- Fonte: `ui-monospace, monospace`
- Tudo uppercase, `font-size: 10.5px`, `letter-spacing: 0.5`
- Conexão: dot glowing + nome colorido com `connectionColor` (já parcialmente feito)
- Autocommit: alinhado à direita, colorido com `connectionColor`
- Versão: alinhada à direita

**Arquivos:** `src/features/connections/ConnectionManager.tsx`

---

## Ordem de execução recomendada

```
1 → 2 → 5 → 6 → 7 → 3 → 4 → 8
```
*(Tema e workspace primeiro para ver o resultado. Title bar e sidebar depois. Status bar por último.)*

---

## Estado atual (completo)

| Item | Status |
|------|--------|
| Paleta de cores por conexão (`getConnectionColor`) | ✅ feito |
| Run button sólido com cor da conexão | ✅ feito |
| Editor left border + glow | ✅ feito |
| Tab strip — dot colorido | ✅ feito |
| Tab strip — indicador superior (top 2px + glow) | ✅ feito |
| Connection selector — dot colorido | ✅ feito |
| Sidebar — left bar por conexão + engine badge | ✅ feito |
| Status bar — nome colorido + dot | ✅ feito |
| Tema ATLAS (cores base) | ✅ feito |
| Ambient connection wash | ✅ feito |
| Title bar (76px left padding para traffic lights) | ✅ feito |
| Result tabs pill style | ✅ feito |
| Sidebar header "CONNECTIONS" ATLAS style | ✅ feito |
| Tab strip flat + top indicator | ✅ feito |
| Status bar monospace/uppercase | ✅ feito |
| macOS backgroundColor atualizado (#08111A) | ✅ feito |
