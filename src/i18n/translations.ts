// All user-facing UI text (not simulation content — there's no in-canvas
// text to translate, see ARCHITECTURE.md) lives here as a flat key ->
// string dictionary per supported language. TranslationKey is derived
// from the English dictionary, so `es`/`fr` are typechecked to provide
// the exact same key set (TS errors on missing/extra keys).

import type { Language } from './language';
import { getLanguage } from './language';

const en = {
  documentTitle: 'AiBoids — Flocking Simulation',
  subtitle: 'A flocking simulation with predators',
  controlsHeading: 'Controls',
  togglePanelTitle: 'Toggle controls panel',

  languageLabel: 'Language',

  modeLabel: 'Mode',
  mode2d: '2D (top-down)',
  mode3d: '3D (orbit camera)',

  visualStyleLabel: 'Visual style',
  visualStyleArcade: 'Arcade (neon glow)',
  visualStyleNature: 'Nature (sky & hawks)',

  sectionPopulationSpeed: 'Population & speed',
  boidCount: 'Boid count (sparrows)',
  parrotCount: 'Parrot count',
  goldfinchCount: 'Goldfinch count',
  cardinalCount: 'Cardinal count',
  bluejayCount: 'Blue jay count',
  predatorCount: 'Predator count',
  unicornCount: 'Unicorn count',
  boidMaxSpeed: 'Boid max speed',
  predatorMaxSpeed: 'Predator max speed',

  sectionBehavior: 'Behavior',
  perceptionRadius: 'Perception radius',
  perceptionAngleDeg: 'Perception angle (°)',
  separationWeight: 'Separation weight',
  alignmentWeight: 'Alignment weight',
  cohesionWeight: 'Cohesion weight',
  separationRadius: 'Separation radius',
  panicRadius: 'Predator panic radius',
  fleeWeight: 'Flee weight',
  predatorCatchLabel: 'Predators can catch prey',

  section3DSettings: '3D settings',
  worldDepth: 'World depth (z)',

  sectionBoundaryBehavior: 'Boundary behavior',
  boundaryMargin: 'Wall steer-away margin',
  boundaryWeight: 'Wall steer-away strength',
  centerPullWeight: 'Center pull (avoids corner-camping)',

  sectionVisualSettings: 'Visual settings',
  trailAmount: 'Motion trail amount',
  debugToggleLabel: 'Show perception/panic radii',
  dragonPredatorsLabel: 'There be dragons',
  fogEnabledLabel: 'Distance fog',

  sectionModelGallery: 'Model Gallery',
  galleryLabel: 'Inspect a single model',
  galleryNone: 'None (normal simulation)',
  galleryUnicorn: 'Unicorn',
  galleryDragon: 'Dragon',
  galleryHawk: 'Hawk',
  galleryParrot: 'Parrot',
  galleryGoldfinch: 'Goldfinch',
  galleryCardinal: 'Cardinal',
  galleryBluejay: 'Blue jay',

  alienInvasionButton: 'Send alien invasion 🛸',
  alienInvasionButtonActive: 'Alien invasion 🛸 ({count}/{max} active)',
  alienInvasionTitleWrongMode: 'Switch to 3D mode to send a flying saucer',
  alienInvasionTitleAtCapacity: 'Up to {max} saucers can be out at once — wait for one to fly off',
  alienInvasionTitleReady: 'A flying saucer descends, tractor-beams nearby boids aboard, then departs',

  respawnButtonIdle: 'Respawn now 🐣',
  respawnButtonPending: 'Respawn now ({count}) 🐣',
  respawnTitlePending: 'Skip the wait and fly the abducted birds back out of the coop immediately',
  respawnTitleIdle: 'No abducted birds are waiting to respawn right now',

  playButton: 'Play',
  pauseButton: 'Pause',
  resetButton: 'Reset',
  restoreDefaultsButton: 'Restore defaults',

  deepLinkButton: 'Copy deep link 🔗',
  deepLinkButtonTitle: 'Copies a URL that restores these exact settings and camera view — great for sharing a bug report or debugging setup',
  deepLinkCopied: 'Link copied! ✅',
  deepLinkCopyFailed: 'Copy failed ❌',
};

export type TranslationKey = keyof typeof en;
type TranslationDict = Record<TranslationKey, string>;

const es: TranslationDict = {
  documentTitle: 'AiBoids — Simulación de bandadas',
  subtitle: 'Una simulación de bandadas con depredadores',
  controlsHeading: 'Controles',
  togglePanelTitle: 'Mostrar/ocultar panel de controles',

  languageLabel: 'Idioma',

  modeLabel: 'Modo',
  mode2d: '2D (vista superior)',
  mode3d: '3D (cámara orbital)',

  visualStyleLabel: 'Estilo visual',
  visualStyleArcade: 'Arcade (brillo neón)',
  visualStyleNature: 'Naturaleza (cielo y halcones)',

  sectionPopulationSpeed: 'Población y velocidad',
  boidCount: 'Cantidad de boids (gorriones)',
  parrotCount: 'Cantidad de loros',
  goldfinchCount: 'Cantidad de jilgueros',
  cardinalCount: 'Cantidad de cardenales',
  bluejayCount: 'Cantidad de arrendajos azules',
  predatorCount: 'Cantidad de depredadores',
  unicornCount: 'Cantidad de unicornios',
  boidMaxSpeed: 'Velocidad máxima de los boids',
  predatorMaxSpeed: 'Velocidad máxima de los depredadores',

  sectionBehavior: 'Comportamiento',
  perceptionRadius: 'Radio de percepción',
  perceptionAngleDeg: 'Ángulo de percepción (°)',
  separationWeight: 'Peso de separación',
  alignmentWeight: 'Peso de alineación',
  cohesionWeight: 'Peso de cohesión',
  separationRadius: 'Radio de separación',
  panicRadius: 'Radio de pánico ante depredadores',
  fleeWeight: 'Peso de huida',
  predatorCatchLabel: 'Los depredadores pueden atrapar presas',

  section3DSettings: 'Ajustes 3D',
  worldDepth: 'Profundidad del mundo (z)',

  sectionBoundaryBehavior: 'Comportamiento en los límites',
  boundaryMargin: 'Margen de alejamiento de paredes',
  boundaryWeight: 'Fuerza de alejamiento de paredes',
  centerPullWeight: 'Atracción al centro (evita acumularse en esquinas)',

  sectionVisualSettings: 'Ajustes visuales',
  trailAmount: 'Cantidad de estela de movimiento',
  debugToggleLabel: 'Mostrar radios de percepción/pánico',
  dragonPredatorsLabel: 'Aquí hay dragones',
  fogEnabledLabel: 'Niebla de distancia',

  sectionModelGallery: 'Galería de modelos',
  galleryLabel: 'Inspeccionar un solo modelo',
  galleryNone: 'Ninguno (simulación normal)',
  galleryUnicorn: 'Unicornio',
  galleryDragon: 'Dragón',
  galleryHawk: 'Halcón',
  galleryParrot: 'Loro',
  galleryGoldfinch: 'Jilguero',
  galleryCardinal: 'Cardenal',
  galleryBluejay: 'Arrendajo azul',

  alienInvasionButton: 'Enviar invasión alienígena 🛸',
  alienInvasionButtonActive: 'Invasión alienígena 🛸 ({count}/{max} activos)',
  alienInvasionTitleWrongMode: 'Cambia al modo 3D para enviar un platillo volador',
  alienInvasionTitleAtCapacity: 'Puede haber hasta {max} platillos a la vez — espera a que uno se aleje',
  alienInvasionTitleReady: 'Un platillo volador desciende, atrae a los boids cercanos con un rayo tractor y luego se marcha',

  respawnButtonIdle: 'Reaparecer ahora 🐣',
  respawnButtonPending: 'Reaparecer ahora ({count}) 🐣',
  respawnTitlePending: 'Omite la espera y haz que las aves abducidas salgan del gallinero de inmediato',
  respawnTitleIdle: 'Ahora mismo no hay aves abducidas esperando para reaparecer',

  playButton: 'Reproducir',
  pauseButton: 'Pausa',
  resetButton: 'Reiniciar',
  restoreDefaultsButton: 'Restaurar valores predeterminados',

  deepLinkButton: 'Copiar enlace directo 🔗',
  deepLinkButtonTitle: 'Copia una URL que restaura exactamente esta configuración y vista de cámara — ideal para compartir un informe de errores',
  deepLinkCopied: '¡Enlace copiado! ✅',
  deepLinkCopyFailed: 'Error al copiar ❌',
};

const fr: TranslationDict = {
  documentTitle: 'AiBoids — Simulation de nuées',
  subtitle: 'Une simulation de nuées avec des prédateurs',
  controlsHeading: 'Commandes',
  togglePanelTitle: 'Afficher/masquer le panneau de commandes',

  languageLabel: 'Langue',

  modeLabel: 'Mode',
  mode2d: '2D (vue de dessus)',
  mode3d: '3D (caméra orbitale)',

  visualStyleLabel: 'Style visuel',
  visualStyleArcade: 'Arcade (lueur néon)',
  visualStyleNature: 'Nature (ciel et faucons)',

  sectionPopulationSpeed: 'Population et vitesse',
  boidCount: 'Nombre de boids (moineaux)',
  parrotCount: 'Nombre de perroquets',
  goldfinchCount: 'Nombre de chardonnerets',
  cardinalCount: 'Nombre de cardinaux',
  bluejayCount: 'Nombre de geais bleus',
  predatorCount: 'Nombre de prédateurs',
  unicornCount: 'Nombre de licornes',
  boidMaxSpeed: 'Vitesse maximale des boids',
  predatorMaxSpeed: 'Vitesse maximale des prédateurs',

  sectionBehavior: 'Comportement',
  perceptionRadius: 'Rayon de perception',
  perceptionAngleDeg: 'Angle de perception (°)',
  separationWeight: 'Poids de séparation',
  alignmentWeight: "Poids d'alignement",
  cohesionWeight: 'Poids de cohésion',
  separationRadius: 'Rayon de séparation',
  panicRadius: 'Rayon de panique face aux prédateurs',
  fleeWeight: 'Poids de fuite',
  predatorCatchLabel: 'Les prédateurs peuvent attraper des proies',

  section3DSettings: 'Paramètres 3D',
  worldDepth: 'Profondeur du monde (z)',

  sectionBoundaryBehavior: 'Comportement aux limites',
  boundaryMargin: "Marge d'évitement des murs",
  boundaryWeight: "Force d'évitement des murs",
  centerPullWeight: "Attraction vers le centre (évite l'entassement dans les coins)",

  sectionVisualSettings: 'Paramètres visuels',
  trailAmount: 'Quantité de traînée de mouvement',
  debugToggleLabel: 'Afficher les rayons de perception/panique',
  dragonPredatorsLabel: 'Ici, il y a des dragons',
  fogEnabledLabel: 'Brouillard de distance',

  sectionModelGallery: 'Galerie de modèles',
  galleryLabel: 'Inspecter un seul modèle',
  galleryNone: 'Aucun (simulation normale)',
  galleryUnicorn: 'Licorne',
  galleryDragon: 'Dragon',
  galleryHawk: 'Faucon',
  galleryParrot: 'Perroquet',
  galleryGoldfinch: 'Chardonneret',
  galleryCardinal: 'Cardinal',
  galleryBluejay: 'Geai bleu',

  alienInvasionButton: 'Envoyer une invasion extraterrestre 🛸',
  alienInvasionButtonActive: 'Invasion extraterrestre 🛸 ({count}/{max} actives)',
  alienInvasionTitleWrongMode: 'Passez en mode 3D pour envoyer une soucoupe volante',
  alienInvasionTitleAtCapacity: "Jusqu'à {max} soucoupes peuvent être présentes en même temps — attendez qu'une reparte",
  alienInvasionTitleReady: 'Une soucoupe volante descend, aspire les boids proches avec un rayon tracteur, puis repart',

  respawnButtonIdle: 'Faire réapparaître maintenant 🐣',
  respawnButtonPending: 'Faire réapparaître maintenant ({count}) 🐣',
  respawnTitlePending: "Sautez l'attente et faites ressortir immédiatement les oiseaux enlevés du poulailler",
  respawnTitleIdle: "Aucun oiseau enlevé n'attend actuellement de réapparaître",

  playButton: 'Lecture',
  pauseButton: 'Pause',
  resetButton: 'Réinitialiser',
  restoreDefaultsButton: 'Restaurer les valeurs par défaut',

  deepLinkButton: 'Copier le lien direct 🔗',
  deepLinkButtonTitle: 'Copie une URL qui restaure exactement ces réglages et cette vue de caméra — idéal pour partager un rapport de bug',
  deepLinkCopied: 'Lien copié ! ✅',
  deepLinkCopyFailed: 'Échec de la copie ❌',
};

const translations: Record<Language, TranslationDict> = { en, es, fr };

/**
 * Looks up `key` in the current language's dictionary (see
 * language.ts's getLanguage()), substituting any `{name}` placeholders
 * from `vars`. Falls back to English if a key is ever missing at
 * runtime (shouldn't happen given the shared TranslationKey type, but
 * cheap insurance against a stale/partial dictionary).
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = translations[getLanguage()][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
