// Administrateur — « Utilisateurs » : création, modification, mot de passe et suppression des comptes.
// Un compte d'agence est obligatoirement rattaché à une agence ; un administrateur n'en a pas.

import type { IUser, Role } from '../api';
import { clear, h, icon } from '../dom';
import { formatDateTime, plural } from '../format';
import {
  agencySelect,
  confirmDialog,
  emptyState,
  field,
  fire,
  IAppContext,
  IView,
  selectedAgency,
  spinner,
} from '../ui';

const ROLE_LABELS: Record<Role, string> = { agent: "Compte d'agence", admin: 'Administrateur' };

/** Mot de passe lisible de 12 caractères (sans 0/O, 1/l/I), à communiquer à l'utilisateur. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const values = new Uint32Array(12);
  window.crypto.getRandomValues(values);
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('');
}

/** Champ « mot de passe » en clair (l'administrateur doit pouvoir le lire pour le transmettre) + bouton Générer. */
function newPasswordField(label: string): { input: HTMLInputElement; el: HTMLElement } {
  const input = h('input', {
    type: 'text',
    className: 'mrt-input mrt-input-mono',
    autocomplete: 'new-password',
    spellcheck: false,
    maxLength: 200,
    minLength: 8,
    required: true,
  });
  const el = field(label, input, '8 caractères minimum. Communiquez-le à l’utilisateur : il pourra le changer depuis « Mon compte ».');
  const row = h('div', { className: 'mrt-inline' });
  el.insertBefore(row, input);
  row.append(
    input,
    h(
      'button',
      {
        type: 'button',
        className: 'mrt-btn mrt-btn-secondary',
        onClick: () => {
          input.value = generatePassword();
          input.focus();
          input.select();
        },
      },
      icon('refresh'),
      'Générer',
    ),
  );
  return { input, el };
}

export function createUsersView(ctx: IAppContext): IView {
  let users: IUser[] = [];
  let active = false;
  let token = 0;

  const listHost = h('div', { className: 'mrt-card mrt-list-card' });
  const count = h('p', { className: 'mrt-hint' });

  /** Choix du rôle + agence (masquée pour un administrateur). */
  function roleFields(initialRole: Role, initialAgency: number | null): {
    el: HTMLElement;
    value(): { role: Role; agencyId: number | null };
    focusAgency(): void;
  } {
    let role = initialRole;
    const agency = agencySelect(ctx.agencies, initialAgency);
    const agencyField = field('Agence', agency, 'Le compte ne voit que les rollers de cette agence.');
    const buttons = (['agent', 'admin'] as Role[]).map((r) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          className: 'mrt-choice',
          onClick: () => {
            role = r;
            sync();
          },
        },
        h('strong', null, ROLE_LABELS[r]),
        h('span', null, r === 'agent' ? 'Scanne et gère les rollers de son agence.' : 'Supervise toutes les agences et gère les comptes.'),
      ),
    );
    const sync = (): void => {
      buttons.forEach((b, i) => {
        const on = (['agent', 'admin'] as Role[])[i] === role;
        b.classList.toggle('mrt-choice-active', on);
        b.setAttribute('aria-checked', String(on));
      });
      agencyField.hidden = role === 'admin';
    };
    sync();
    return {
      el: h(
        'div',
        { className: 'mrt-form' },
        h('div', { className: 'mrt-choice-list mrt-choice-row', role: 'radiogroup', 'aria-label': 'Type de compte' }, buttons),
        agencyField,
      ),
      value: () => ({ role, agencyId: role === 'admin' ? null : selectedAgency(agency) }),
      focusAgency: () => agency.focus(),
    };
  }

  function formActions(close: () => void, submit: HTMLButtonElement): HTMLElement {
    return h(
      'div',
      { className: 'mrt-form-actions' },
      h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
      submit,
    );
  }

  function openCreate(): void {
    let close: () => void = () => undefined;
    const username = h('input', {
      type: 'text',
      className: 'mrt-input',
      maxLength: 40,
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: false,
      placeholder: 'Ex. : j.dupont',
      required: true,
    });
    const password = newPasswordField('Mot de passe');
    const roles = roleFields('agent', ctx.agencyFilter);
    const error = h('p', { className: 'mrt-form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Créer le compte');
    const form = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          const { role, agencyId } = roles.value();
          if (role === 'agent' && agencyId === null) {
            error.textContent = 'Choisissez l’agence de ce compte.';
            roles.focusAgency();
            return;
          }
          submit.disabled = true;
          error.textContent = '';
          ctx.api
            .createUser({ username: username.value.trim(), password: password.input.value, role, agencyId })
            .then((u) => {
              close();
              ctx.toast(`Compte « ${u.username} » créé.`, 'success');
              ctx.notifyChanged();
            })
            .catch((err: unknown) => {
              submit.disabled = false;
              error.textContent = err instanceof Error ? err.message : 'Création impossible.';
            });
        },
      },
      field('Identifiant', username, 'Lettres sans accent, chiffres, point ou tiret. Ex. : j.dupont'),
      password.el,
      roles.el,
      error,
      formActions(() => close(), submit),
    );
    close = ctx.openModal({ title: 'Nouvel utilisateur', body: form });
  }

  function openEdit(user: IUser): void {
    let close: () => void = () => undefined;
    const roles = roleFields(user.role, user.agency?.id ?? null);
    const error = h('p', { className: 'mrt-form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Enregistrer');
    const form = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          const { role, agencyId } = roles.value();
          if (role === 'agent' && agencyId === null) {
            error.textContent = 'Choisissez l’agence de ce compte.';
            roles.focusAgency();
            return;
          }
          submit.disabled = true;
          ctx.api
            .updateUser(user.id, { role, agencyId })
            .then((u) => {
              close();
              ctx.toast(`Compte « ${u.username} » modifié.`, 'success');
              ctx.notifyChanged();
            })
            .catch((err: unknown) => {
              submit.disabled = false;
              error.textContent = err instanceof Error ? err.message : 'Enregistrement impossible.';
            });
        },
      },
      roles.el,
      h('p', { className: 'mrt-hint' }, 'Si le type de compte ou l’agence change, l’utilisateur devra se reconnecter.'),
      error,
      formActions(() => close(), submit),
    );
    close = ctx.openModal({ title: `Modifier « ${user.username} »`, body: form });
  }

  function openPassword(user: IUser): void {
    let close: () => void = () => undefined;
    const password = newPasswordField('Nouveau mot de passe');
    const error = h('p', { className: 'mrt-form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, icon('key'), 'Changer le mot de passe');
    const form = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          submit.disabled = true;
          ctx.api
            .updateUser(user.id, { password: password.input.value })
            .then(() => {
              close();
              ctx.toast(`Mot de passe de « ${user.username} » changé.`, 'success');
              ctx.notifyChanged();
            })
            .catch((err: unknown) => {
              submit.disabled = false;
              error.textContent = err instanceof Error ? err.message : 'Changement impossible.';
            });
        },
      },
      password.el,
      user.id === ctx.user.id ? null : h('p', { className: 'mrt-hint' }, 'Les appareils où ce compte est connecté seront déconnectés.'),
      error,
      formActions(() => close(), submit),
    );
    close = ctx.openModal({ title: `Mot de passe de « ${user.username} »`, body: form });
  }

  async function remove(user: IUser): Promise<void> {
    const ok = await confirmDialog(ctx, {
      title: 'Supprimer le compte',
      message: `Supprimer le compte « ${user.username} » ? Il ne pourra plus se connecter. L’historique de ses scans est conservé.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.api.deleteUser(user.id);
      ctx.toast(`Compte « ${user.username} » supprimé.`, 'success');
      ctx.notifyChanged();
    } catch (err) {
      ctx.toast(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
    }
  }

  function render(): void {
    clear(listHost);
    if (users.length === 0) {
      listHost.appendChild(emptyState('Aucun utilisateur', 'Créez le premier compte.'));
      return;
    }
    const tbody = h('tbody', null);
    for (const u of users) {
      const me = u.id === ctx.user.id;
      tbody.appendChild(
        h(
          'tr',
          null,
          h(
            'td',
            { className: 'mrt-td-code' },
            h('span', { className: 'mrt-code' }, u.username),
            me ? h('span', { className: 'mrt-sub' }, 'Vous') : null,
          ),
          h(
            'td',
            { 'data-label': 'Type' },
            h(
              'span',
              { className: `mrt-badge ${u.role === 'admin' ? 'mrt-badge-admin' : 'mrt-badge-agent'}` },
              icon(u.role === 'admin' ? 'shield' : 'user'),
              ROLE_LABELS[u.role],
            ),
          ),
          h('td', { 'data-label': 'Agence' }, u.agency ? u.agency.name : h('span', { className: 'mrt-muted' }, 'Toutes')),
          h(
            'td',
            { className: 'mrt-td-last', 'data-label': 'Dernière connexion' },
            u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Jamais',
          ),
          h(
            'td',
            { className: 'mrt-td-actions' },
            h(
              'button',
              { type: 'button', className: 'mrt-icon-btn', title: 'Modifier le type et l’agence', 'aria-label': `Modifier ${u.username}`, onClick: () => openEdit(u) },
              icon('edit'),
            ),
            h(
              'button',
              { type: 'button', className: 'mrt-icon-btn', title: 'Changer le mot de passe', 'aria-label': `Mot de passe de ${u.username}`, onClick: () => openPassword(u) },
              icon('key'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mrt-icon-btn mrt-icon-btn-danger',
                title: me ? 'Vous ne pouvez pas supprimer votre propre compte' : 'Supprimer',
                'aria-label': `Supprimer ${u.username}`,
                disabled: me,
                onClick: () => fire(remove(u)),
              },
              icon('trash'),
            ),
          ),
        ),
      );
    }
    listHost.appendChild(
      h(
        'table',
        { className: 'mrt-table mrt-table-admin' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Identifiant'),
            h('th', null, 'Type'),
            h('th', null, 'Agence'),
            h('th', null, 'Dernière connexion'),
            h('th', { className: 'mrt-td-actions' }, h('span', { className: 'mrt-sr' }, 'Actions')),
          ),
        ),
        tbody,
      ),
    );
  }

  async function load(): Promise<void> {
    const t = ++token;
    if (users.length === 0) {
      clear(listHost);
      listHost.appendChild(spinner());
    }
    try {
      const list = await ctx.api.users();
      if (t !== token) return;
      users = list;
      count.textContent = plural(list.length, 'compte');
      render();
    } catch (err) {
      if (t !== token) return;
      clear(listHost);
      listHost.appendChild(emptyState('Chargement impossible', err instanceof Error ? err.message : ''));
    }
  }

  const root = h(
    'div',
    { className: 'mrt-view' },
    h(
      'div',
      { className: 'mrt-toolbar' },
      h('div', null, h('h2', { className: 'mrt-view-title' }, 'Utilisateurs'), count),
      h(
        'div',
        { className: 'mrt-toolbar-actions' },
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-primary', onClick: () => openCreate() }, icon('plus'), 'Nouvel utilisateur'),
      ),
    ),
    listHost,
  );

  const unsubscribe = ctx.onChanged(() => {
    if (active) fire(load());
  });

  return {
    el: root,
    activate() {
      active = true;
      fire(load());
    },
    deactivate() {
      active = false;
    },
    dispose() {
      unsubscribe();
    },
  };
}
