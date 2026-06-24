# TCA ↔ Nexus Linker

Interface web permettant aux experts du Nexus de comparer les **22 actions du TCA**
avec les **71 options de réponse du Nexus** et de créer des liens (primaire / secondaire)
là où ils voient une pertinence. L'app ne propose aucun rapprochement automatique :
elle sert uniquement le jugement des experts et rend visible leur accord.

- Listes côte à côte (actions TCA groupées par stratégie / options Nexus groupées par catégorie).
- Définitions affichées au clic pour vérifier la pertinence.
- Liens n-à-n, **primaire** ou **secondaire**, modifiables et supprimables par leur auteur.
- Jugements **attribués** par nom ; **badge d'accord** dès que ≥ 2 experts relient la même
  paire avec la même force.
- Authentification **sans mot de passe** (lien magique par e-mail, Supabase Auth).

## Stack

React + Vite + Tailwind (frontend statique) · Supabase (Postgres + Auth + Realtime).

---

## Mise en place

### 1. Créer le projet Supabase
1. Sur [supabase.com](https://supabase.com), crée un projet (niveau gratuit suffisant).
2. **SQL Editor → New query** : colle le contenu de [`supabase_schema.sql`](./supabase_schema.sql) et exécute.
   (Crée les tables `experts` et `links`, les règles RLS, et active le Realtime.)
3. **Authentication → Providers → Email** : laisse activé (magic-link). Désactive
   « Confirm email » seulement si tu veux simplifier les tests.
4. **Authentication → URL Configuration** : ajoute l'URL où l'app tournera
   (`http://localhost:5173` en dev, puis l'URL de prod) dans *Redirect URLs*.
5. *(Optionnel)* Pour restreindre l'accès aux experts invités : décommente le bloc
   `allowed_emails` à la fin de `supabase_schema.sql`, exécute-le, puis ajoute les
   e-mails autorisés dans la table `allowed_emails`.

### Ajouter les commentaires à une base existante

Si les tables existaient avant l'ajout des commentaires, exécute une seule fois
[`supabase_migrations/20260623_add_link_comments.sql`](./supabase_migrations/20260623_add_link_comments.sql)
dans **Supabase → SQL Editor**. Cette migration n'efface aucune donnée.

### 2. Configurer l'app
1. **Project Settings → API** : copie *Project URL* et *anon public key*.
2. Copie `.env.example` en `.env` et renseigne :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

### 3. Lancer en local
```bash
npm install
npm run dev
```
Ouvre http://localhost:5173, saisis ton e-mail, clique le lien reçu, choisis ton nom d'affichage.

### 4. Déployer (Vercel ou Netlify)
- Pousse `app/` dans un dépôt Git.
- Importe le projet sur Vercel/Netlify (build : `npm run build`, dossier de sortie : `dist`).
- Ajoute les variables d'environnement `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
- Ajoute l'URL de prod dans les *Redirect URLs* Supabase (étape 1.4).

---

## Données

`src/data/tca_actions.json` (22) et `src/data/nexus_options.json` (71) sont extraits de
`../../TCA and Nexus Definitions.xlsx` (onglets `TCA_Actions_Ch5` et `Nexus_Response_Options`).
Pour régénérer après modification de l'Excel, ré-exécute le script d'extraction (openpyxl).
