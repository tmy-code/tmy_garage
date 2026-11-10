# The Notion databases

The structure of the databases under the Notion parent page (`NOTION_PARENT_PAGE_ID`), column by column, and how they link.
How the sync uses them is in [notion-copy.md](notion-copy.md); why, in [ADR 0007](adr/0007-two-way-notion-sync.md).

**Who writes each column:**
- **Owner**: typed in Notion; the app only reads it.
- **App**: rewritten by every push, so edits in Notion are lost.
- **Notion**: the back-link of a two-way relation, kept by Notion itself.

The app finds a database by its title and a column by its name, so renaming either breaks the sync. Extra columns are
ignored. Every relation is two-way: the column named in **Back-link** is the same link seen from the other database.

## How they link

```mermaid
erDiagram
    VEHICULES ||--o{ SPECIFICATIONS : "Véhicule"
    VEHICULES ||--o{ CONSOMMABLES_PAR_VEHICULE : "Véhicule"
    VEHICULES ||--o{ PLANS_D_ENTRETIEN : "Véhicule"
    VEHICULES ||--o{ SEANCES : "Véhicule"
    VEHICULES ||--o{ ARTICLES : "Véhicule"
    VEHICULES ||--o{ CARACTERISTIQUES : "Véhicule"
    TACHES_D_ENTRETIEN ||--o{ PLANS_D_ENTRETIEN : "Tâche"
    TACHES_D_ENTRETIEN }o--o{ TYPES_DE_CONSOMMABLES : "Types de consommables requis"
    TACHES_D_ENTRETIEN }o--o{ TYPES_DE_COMPOSANTS : "Composants"
    TACHES_D_ENTRETIEN }o--o{ OUTILS : "Outils"
    TYPES_DE_COMPOSANTS ||--o{ SPECIFICATIONS : "Composant"
    TYPES_DE_CONSOMMABLES ||--o{ PRODUITS : "Type de consommable"
    TYPES_DE_CONSOMMABLES ||--o{ CONSOMMABLES_PAR_VEHICULE : "Type"
    PRODUITS }o--o{ CONSOMMABLES_PAR_VEHICULE : "Produits compatibles, Produit retenu"
    SEANCES ||--o{ INTERVENTIONS : "Séance"
    TACHES_D_ENTRETIEN ||--o{ INTERVENTIONS : "Tâche"
    PLANS_D_ENTRETIEN ||--o{ INTERVENTIONS : "Plan"
    INTERVENTIONS ||--o{ CONSOMMABLES_UTILISES : "Intervention"
    TYPES_DE_CONSOMMABLES ||--o{ CONSOMMABLES_UTILISES : "Type de consommable"
    PRODUITS ||--o{ CONSOMMABLES_UTILISES : "Produit utilisé"
    CARACTERISTIQUES ||--o{ ARTICLES : "Caractéristique"
```

The databases fall into four groups:

| Group | Databases | Made by |
| --- | --- | --- |
| Catalogue | Tâches d'entretien, Types de composants, Types de consommables, Produits, Outils | Owner |
| Per vehicle | Spécifications, Consommables par véhicule, Plans d'entretien | Owner (the app creates plan pages) |
| Copied from the app | Véhicules, Articles, Séances, Interventions, Consommables utilisés | App |
| Frozen | Caractéristiques | Neither: no longer written, kept for history |

## The category labels

The app files tasks and specs under seven categories. In Notion, the **Catégorie** of *Tâches d'entretien* uses the app's
French labels: Moteur, Transmission, Freinage, Châssis, Électricité, Refroidissement et climatisation, Autre. The app also
accepts Freins (Freinage), Roues (Châssis) and Électrique (Électricité), which *Spécifications* and *Types de composants*
still use. *Types de consommables* has its own list on purpose, grouped by kind of product (Lubrifiants, Fluides, Freinage,
Filtres, Allumage, Transmission, Pneus).

## Catalogue

### Tâches d'entretien

One row per maintenance task, shared by every vehicle it applies to.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Tâche | title | Owner | Required. The task name in the app. |
| Action | select | Owner | Required. Contrôle or Remplacement. |
| Applicable si | multi-select | Owner | Required. Equipment tags, all of which the vehicle needs. Empty means every vehicle. |
| Intervalle par défaut (km) | number | Owner | Required column, may be empty. |
| Intervalle par défaut (mois) | number | Owner | Required column, may be empty. A task with neither interval is not added. |
| Catégorie | select | Owner | The section the task is listed under in the app. Empty keeps the task's own. |
| Instructions | text | Owner | Shown on the task sheet. |
| Types de consommables requis | relation → Types de consommables | Owner | Back-link: Tâches. |
| Composants | relation → Types de composants | Owner | Back-link: Tâches. Brings their torque values. |
| Outils | relation → Outils | Owner | Back-link: Tâches. |
| Plans d'entretien | relation ← Plans d'entretien | Notion | Back-link of Plans' Tâche. |
| Interventions | relation ← Interventions | Notion | Back-link of Interventions' Tâche. |

### Types de composants

A kind of part that has specs, such as torque values.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Nom | title | Owner | Required. |
| Catégorie | select | Owner | Moteur, Freins, Roues, Châssis, Transmission, Électrique, Refroidissement et climatisation, Autre. |
| Notes | text | Owner | |
| Tâches | relation ← Tâches d'entretien | Notion | Back-link of Composants. |
| Spécifications | relation ← Spécifications | Notion | Back-link of Composant. |

### Types de consommables

A kind of consumable shared by every vehicle (engine oil, front brake pads…).

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Nom | title | Owner | Required. |
| Famille | select | Owner | Fluide or Pièce. |
| Catégorie | select | Owner | Lubrifiants, Fluides, Freinage, Filtres, Allumage, Transmission, Pneus. |
| Notes | text | Owner | |
| Tâches | relation ← Tâches d'entretien | Notion | Back-link of Types de consommables requis. |
| Produits | relation ← Produits | Notion | Back-link of Type de consommable. |
| Consommables par véhicule | relation ← Consommables par véhicule | Notion | Back-link of Type. |
| Consommables utilisés | relation ← Consommables utilisés | Notion | Back-link of Type de consommable. |

### Produits

A product sold, which can be picked when logging a session.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Nom | title | Owner | Required. |
| Type de consommable | relation → Types de consommables | Owner | Back-link: Produits. |
| Marque, Référence, Fournisseur | text | Owner | The maker's reference lives here, not on the vehicle. |
| Prix | number (€) | Owner | A default; the price paid is logged per session. |
| Notes | text | Owner | |
| Compatible avec | relation ← Consommables par véhicule | Notion | Back-link of Produits compatibles. |
| Retenu pour | relation ← Consommables par véhicule | Notion | Back-link of Produit retenu. |
| Utilisé dans | relation ← Consommables utilisés | Notion | Back-link of Produit utilisé. |

### Outils

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Nom | title | Owner | Required. |
| Type | select | Owner | Clé dynamométrique, Douille, Clé, Tournevis, Spécifique, Consommable atelier. |
| Taille / capacité | text | Owner | |
| Possédé | checkbox | Owner | |
| Prix | number (€) | Owner | |
| Notes | text | Owner | |
| Tâches | relation ← Tâches d'entretien | Notion | Back-link of Outils. |

## Per vehicle

### Spécifications

A vehicle's own values: torques, capacities, pressures, sizes.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Élément | title | Owner | Required. |
| Véhicule | relation → Véhicules | Owner | Required. Back-link: Spécifications. A page linked to several vehicles counts for each. |
| Valeur | number | Owner | Required. Text is accepted too. |
| Unité | select | Owner | N·m, L, mm, bar. |
| Composant | relation → Types de composants | Owner | Back-link: Spécifications. |
| Catégorie | select | Owner | Same labels as Types de composants. |
| Source | text | Owner | Where the value comes from. |
| Statut | select | Owner | Confirmé or À confirmer. |

### Consommables par véhicule

Which consumable of each type a vehicle takes, and how much.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Désignation | title | Owner | Required. |
| Véhicule | relation → Véhicules | Owner | Required. Back-link: Consommables. |
| Type | relation → Types de consommables | Owner | Required. Back-link: Consommables par véhicule. |
| Spécification | text | Owner | Grade or standard (e.g. 10W-30). |
| Réf. OEM | text | Owner | The maker's part number. |
| Capacité | text | Owner | |
| Quantité | text | Owner | A leading number is read (e.g. "0,5 L"). |
| Produits compatibles | relation → Produits | Owner | Back-link: Compatible avec. |
| Produit retenu | relation → Produits | Owner | Back-link: Retenu pour. |
| Statut | select | Owner | Confirmé or À confirmer. |

### Plans d'entretien

One page per vehicle and task. The app creates a page when a catalogue task applies and none exists.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Plan | title | App, at creation | Required. |
| Véhicule | relation → Véhicules | App, at creation | Required. Back-link: Plans d'entretien. One vehicle per page. |
| Tâche | relation → Tâches d'entretien | App, at creation | Required. Back-link: Plans d'entretien. |
| Intervalle (km), Intervalle (mois) | number | Owner | This vehicle's interval; replaces the catalogue's default where filled. |
| Dernier fait (km), Dernier fait (date) | number, date | App | From the last session that did the task, or its starting point. |
| Notes | text | Owner | Shown on the app's task. |
| Interventions | relation ← Interventions | Notion | Back-link of Interventions' Plan. |

## Copied from the app

Each of these databases has **ID app** (text, the app's id, which links a page to its record) and **Supprimé de l’app**
(checkbox, ticked when the record is gone from the app; the page is kept). Both are written by the app.

### Véhicules

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Nom | title | App | |
| Type | select | App | Voiture or Moto. |
| Marque, Modèle, Motorisation | text | App | |
| Année, Kilométrage, Km par jour | number | App | |
| Relevé le, Copié le | date | App | |
| Équipements | multi-select | Owner | Moto, Transmission chaîne, Refroidissement liquide, Frein avant disque, Frein arrière disque, ABS. Decides which catalogue tasks apply. |
| JDex | text | Owner | Filing reference. |
| Spécifications, Consommables, Plans d'entretien, Séances | relations | Notion | Back-links. |

### Articles

The parts and fluids bought for a vehicle, for deal hunting.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Article | title | App | |
| Référence | text | App | |
| État | select | App | À acheter or Achetée. |
| Unité | select | App | litre or pièce. |
| Quantité habituelle | number | App | |
| Dernier prix unitaire | number (€) | App | |
| Tâche | text | App | The task's name, as text. |
| Échéance | date | App | |
| Statut | select | App | The task's status. |
| Véhicule | relation → Véhicules | App | One-way. |
| Lien affaire | url | Owner | |
| Prix affaire | number (€) | Owner | |
| Boutique | text | Owner | |
| Vérifié le | date | Owner | |
| Caractéristique | relation → Caractéristiques | Nobody | Left from the earlier copy, no longer written. |

### Séances

One per session logged in the app.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Séance | title | App | |
| Véhicule | relation → Véhicules | App | Back-link: Séances. |
| Date | date | App | |
| Km | number | App | |
| Réalisé par | select | App | Who did it. |
| Type | select | App | Entretien or Réparation. |
| Interventions | relation ← Interventions | Notion | Back-link of Séance. |

### Interventions

One per task done in a session.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Intervention | title | App | |
| Séance | relation → Séances | App | Back-link: Interventions. |
| Tâche | relation → Tâches d'entretien | App | Back-link: Interventions. Empty for a task made in the app. |
| Plan | relation → Plans d'entretien | App | Back-link: Interventions. |
| Action | select | App | Contrôle or Remplacement. |
| Consommables utilisés | relation ← Consommables utilisés | Notion | Back-link of Intervention. |

### Consommables utilisés

One per part or fluid line of a session.

| Column | Type | Written by | Notes |
| --- | --- | --- | --- |
| Ligne | title | App | |
| Intervention | relation → Interventions | App | Back-link: Consommables utilisés. |
| Type de consommable | relation → Types de consommables | App | Back-link: Consommables utilisés. |
| Produit utilisé | relation → Produits | App | Back-link: Utilisé dans. Empty for a line typed by hand. |
| Désignation | text | App | |
| Quantité | number | App | |
| Prix unitaire | number (€) | App | |

## Frozen

### Caractéristiques

The earlier per-vehicle specs, replaced by *Spécifications* and *Consommables par véhicule*. Nothing writes it any more
and nothing is deleted. Columns: Caractéristique (title), Véhicule (relation, one-way), Catégorie, Groupe (Fluides /
Pièces), Valeur, Réf. OEM, ID app, Supprimé de l’app.

## If a relation is recreated

The app creates a missing relation column of its own databases (Séances, Interventions, Consommables utilisés, Articles)
as **one-way**. If that happens, turn it back into a two-way relation in Notion (column menu › Edit property › Show on
the other database), with the back-link name from the tables above.
