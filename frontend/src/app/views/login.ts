// Écrans de connexion et de changement du mot de passe provisoire (avant l'accès à l'application).

import type { ApiClient, IUser } from '../api';
import { MEWA_LOGO_SVG } from '../brand/logo';
import { h, icon } from '../dom';
import { field } from '../ui';

/** Champ mot de passe avec un bouton « afficher / masquer ». */
function passwordField(label: string, autocomplete: string, hint?: string): { input: HTMLInputElement; el: HTMLElement } {
  const input = h('input', { type: 'password', className: 'mrt-input', autocomplete, maxLength: 200, required: true });
  const toggle = h(
    'button',
    {
      type: 'button',
      className: 'mrt-icon-btn mrt-pw-toggle',
      'aria-label': 'Afficher le mot de passe',
      'aria-pressed': 'false',
      onClick: () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        input.focus();
      },
    },
    icon('eye'),
  );
  const el = field(label, input, hint);
  const wrap = h('div', { className: 'mrt-pw' });
  el.insertBefore(wrap, input);
  wrap.append(input, toggle);
  return { input, el };
}

function screen(...children: HTMLElement[]): HTMLElement {
  return h(
    'div',
    { className: 'mrt-login' },
    h(
      'div',
      { className: 'mrt-login-card mrt-pop' },
      h(
        'div',
        { className: 'mrt-login-brand' },
        h('span', { className: 'mrt-logo', html: MEWA_LOGO_SVG }),
        h('span', { className: 'mrt-login-title' }, 'Suivi des rollers'),
      ),
      ...children,
    ),
    h('p', { className: 'mrt-login-foot' }, 'Outil interne Mewa · Service informatique'),
  );
}

export function createLoginScreen(api: ApiClient, onLoggedIn: (user: IUser) => void, notice?: string): HTMLElement {
  const username = h('input', {
    type: 'text',
    className: 'mrt-input',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: false,
    maxLength: 40,
    required: true,
  });
  const password = passwordField('Mot de passe', 'current-password');
  const error = h('p', { className: 'mrt-form-error', role: 'alert' }, notice ?? '');
  const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary mrt-btn-block' }, 'Se connecter');
  const form = h(
    'form',
    {
      className: 'mrt-form',
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (!username.value.trim() || !password.input.value) {
          error.textContent = 'Saisissez votre identifiant et votre mot de passe.';
          return;
        }
        submit.disabled = true;
        error.textContent = '';
        api
          .login(username.value.trim(), password.input.value)
          .then(onLoggedIn)
          .catch((err: unknown) => {
            submit.disabled = false;
            password.input.value = '';
            error.textContent = err instanceof Error ? err.message : 'Connexion impossible.';
            password.input.focus();
          });
      },
    },
    h('h1', { className: 'mrt-login-heading' }, 'Connexion'),
    field('Identifiant', username),
    password.el,
    error,
    submit,
    h('p', { className: 'mrt-hint mrt-login-help' }, 'Mot de passe oublié ? Demandez à un administrateur de le réinitialiser.'),
  );
  // Focus automatique, sauf si l'utilisateur a déjà commencé à saisir.
  window.setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) username.focus();
  }, 30);
  return screen(form);
}

/** Changement du mot de passe : imposé (mot de passe provisoire) ou à la demande depuis le menu du compte. */
export function passwordChangeForm(
  api: ApiClient,
  onDone: (user: IUser) => void,
  options: { onCancel?: () => void; cancelLabel?: string } = {},
): HTMLFormElement {
  const current = passwordField('Mot de passe actuel', 'current-password');
  const next = passwordField('Nouveau mot de passe', 'new-password', '8 caractères minimum.');
  const confirm = passwordField('Confirmer le nouveau mot de passe', 'new-password');
  const error = h('p', { className: 'mrt-form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Changer le mot de passe');
  const form = h(
    'form',
    {
      className: 'mrt-form',
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (next.input.value.length < 8) {
          error.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères.';
          next.input.focus();
          return;
        }
        if (next.input.value !== confirm.input.value) {
          error.textContent = 'Les deux saisies du nouveau mot de passe sont différentes.';
          confirm.input.focus();
          return;
        }
        submit.disabled = true;
        error.textContent = '';
        api
          .changePassword(current.input.value, next.input.value)
          .then(onDone)
          .catch((err: unknown) => {
            submit.disabled = false;
            error.textContent = err instanceof Error ? err.message : 'Changement impossible.';
          });
      },
    },
    current.el,
    next.el,
    confirm.el,
    error,
    h(
      'div',
      { className: 'mrt-form-actions' },
      options.onCancel
        ? h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: options.onCancel }, options.cancelLabel ?? 'Annuler')
        : null,
      submit,
    ),
  );
  return form;
}

export function createPasswordChangeScreen(api: ApiClient, user: IUser, onDone: (user: IUser) => void, onLogout: () => void): HTMLElement {
  const form = passwordChangeForm(api, onDone, { onCancel: onLogout, cancelLabel: 'Se déconnecter' });
  window.setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) form.querySelector('input')?.focus();
  }, 30);
  return screen(
    h('h1', { className: 'mrt-login-heading' }, 'Nouveau mot de passe'),
    h(
      'p',
      { className: 'mrt-login-text' },
      `Bonjour ${user.username}. Votre mot de passe est provisoire : choisissez-en un nouveau pour continuer.`,
    ),
    form,
  );
}
