/** Ordered menu focus shared by rotary simulation, keyboard and BLE directions. */
export class MenuNavigation {
  private target: HTMLButtonElement | null = null;
  private buttons(root: HTMLElement) {
    return [...root.querySelectorAll<HTMLButtonElement>('button[data-controller]')]
      .filter(button => !button.disabled && button.getClientRects().length > 0);
  }
  move(root: HTMLElement, direction: -1 | 1) {
    const buttons = this.buttons(root); if (!buttons.length) return;
    const focused = buttons.includes(document.activeElement as HTMLButtonElement) ? document.activeElement : this.target;
    const index = buttons.indexOf(focused as HTMLButtonElement);
    this.target = buttons[index < 0 ? (direction === 1 ? 0 : buttons.length - 1) : (index + direction + buttons.length) % buttons.length];
    this.target.focus(); this.target.scrollIntoView({ block: 'nearest' });
  }
  activate(root: HTMLElement) {
    const buttons = this.buttons(root);
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && root.contains(focused) && focused.hasAttribute('data-controller')) {
      if (buttons.includes(focused)) focused.click();
      return;
    }
    if (this.target && root.contains(this.target) && this.target.getClientRects().length > 0) {
      if (buttons.includes(this.target)) this.target.click();
      return;
    }
    // A previous screen or disabled target must not activate a different action.
    // With no selection, the first press establishes visible focus only.
    this.move(root, 1);
  }
}
