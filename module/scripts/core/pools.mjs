/**
 * §296 (repasse C2) : les réserves de soins ou de PV temporaires « réparties entre les créatures de votre choix » (Survivance, Guérison
 * de groupe, Cavalcade mécanique, Châtiment exaltant). Pur : aucune dépendance à Foundry.
 */

/**
 * Parts d'une réserve — à parts égales, chaque part plafonnée (`caps`) ; ce qu'une créature ne peut pas prendre revient aux autres.
 * Pur. Rend les montants dans l'ordre des plafonds.
 */
export function splitPool(total, caps) {
  const shares = caps.map(() => 0);
  let left = Math.max(0, Math.floor(total));
  let open = caps.map((c, i) => i).filter(i => caps[i] > 0);
  while ( (left > 0) && open.length ) {
    const each = Math.max(1, Math.floor(left / open.length));
    for ( const i of [...open] ) {
      if ( left <= 0 ) break;
      const give = Math.min(each, caps[i] - shares[i], left);
      shares[i] += give; left -= give;
    }
    open = open.filter(i => shares[i] < caps[i]);
  }
  return shares;
}

