/**
 * Pacte de la lame (SPEC §16.45). Monde `ravenloft` : Kaalisti (Porte-Fardeau, Hache de bataille argentée). Le choix de la
 * fenêtre est passé d'office (`enchantItem`, `pactDamage`) ; l'invocation depuis le compendium demande un clic (hors scénario).
 *  1. Pacte radiant sur Porte-Fardeau : l'enchantement fixe le type radiant (seul), fait lire le Charisme (caractéristique
 *     d'incantation) aux attaques de l'arme, et renomme l'arme « … (arme de pacte) ».
 *  2. Nouveau pacte sur la Hache : le lien de Porte-Fardeau tombe.
 * Non applicable sans Kaalisti. Retire les enchantements à la fin.
 */
const MODULE_ID = "dnd5e-combat";
const PROFILE = "QElum2XYhYUYQ5l2";
const ACTIVITY = "8MSXmrGSgc6xHotB";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Pacte de la lame — type choisi, Charisme, un seul pacte",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Kaalisti") ) { ctx.log("Kaalisti absent : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    const actor = async () => ctx.call("get-actor", { actorId: warlock.actorId });
    const weapons = (await actor()).items.filter(i => i.type === "weapon" && i.system?.type?.value !== "natural");
    const [first, second] = weapons;
    ctx.expect(!!first && !!second, `deux armes (${weapons.map(w => w.name).join(", ")})`);
    if ( !first || !second ) return;
    const uuidOf = w => `Actor.${warlock.actorId}.Item.${w._id}`;
    const pactEffects = async w => ((await actor()).items.find(i => i._id === w._id)?.effects ?? []).filter(e => e.flags?.dnd5e?.enchantmentProfile === PROFILE);
    ctx.restore(async () => {
      for ( const w of [first, second] ) for ( const e of await pactEffects(w) ) {
        await ctx.call("remove-embedded-effect", { uuid: uuidOf(w), effectId: e._id }).catch(() => {});
      }
    });
    const pact = (weapon, pactDamage) => ctx.use({ tokenId: warlock.id, identifier: "pact-of-the-blade", activityId: ACTIVITY,
      usageConfig: { enchantmentProfile: PROFILE, [MODULE_ID]: { enchantItem: uuidOf(weapon), pactDamage } } });

    // 1. Pacte radiant.
    const used = await pact(first, "radiant");
    ctx.expect(used.used, "Forge Pact Weapon utilisé");
    await pause(3000);
    const [ench] = await pactEffects(first);
    ctx.expect(!!ench, `${first.name} : lien posé (${ench?.name})`);
    const changes = ench?.system?.changes ?? ench?.changes ?? [];
    const types = changes.filter(c => c.key === "system.damage.base.types");
    ctx.expect((types.length === 1) && (types[0].type === "override") && (types[0].value === "radiant"), `type de dégâts : radiant seul (${JSON.stringify(types.map(c => `${c.type}:${c.value}`))})`);
    ctx.expect(changes.some(c => (c.key === "activities[attack].attack.ability") && (c.value === "spellcasting")), "attaques de l'arme au Charisme (caractéristique d'incantation)");
    const renamed = (await actor()).items.find(i => i._id === first._id)?.name ?? "";
    ctx.log(`nom de l'arme : ${renamed}`);
    ctx.expect(/arme de pacte|pact weapon/i.test(changes.find(c => c.key === "name")?.value ?? ""), "nom : « (arme de pacte) »");

    // 2. Un seul pacte.
    await pact(second, null);
    await pause(3000);
    ctx.expect((await pactEffects(second)).length === 1, `${second.name} : lien posé (type normal)`);
    ctx.expect(!(await pactEffects(first)).length, `${first.name} : l'ancien lien est tombé`);
  }
};
