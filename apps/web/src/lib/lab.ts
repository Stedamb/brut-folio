import type { Locale } from './i18n';

/** An experiment in the Lab: a standalone page, with a still to preview it. */
export interface Experiment {
  href: string;
  image: string;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  date: string;
}

// Newest first.
export const experiments: Experiment[] = [
  {
    href: '/lab/walk',
    image: '/lab/berlin-walk.jpg',
    date: '2026-11',
    title: { it: 'Passeggiata a Berlino', en: 'A walk in Berlin' },
    description: {
      it: 'La stessa Berlino in miniatura, ma a piedi e sempre in ASCII: il lungofiume della Sprea, il Lustgarten, il Duomo e la Fernsehturm ad altezza d’occhio. WASD o frecce per camminare, mouse per guardarsi intorno, R per vedere il 3D che c’è sotto.',
      en: 'The same miniature Berlin, on foot and still in ASCII: the Spree’s promenade, the Lustgarten, the Dom and the Fernsehturm at eye level. WASD or arrows to walk, the mouse to look around, R to see the 3D underneath.',
    },
  },
  {
    href: '/lab/diorama',
    image: '/lab/berlin-diorama.jpg',
    date: '2026-11',
    title: { it: 'Berlino in miniatura', en: 'Berlin in miniature' },
    description: {
      it: "Un diorama tilt-shift in ASCII a colori, in three.js: la Sprea, la Fernsehturm, il Duomo, i tigli d'oro di novembre e un tram giallo, sotto la luce reale di Berlino. Un'alternativa provata per l'hero della homepage.",
      en: 'A tilt-shift diorama in coloured ASCII, in three.js: the Spree, the Fernsehturm, the Dom, lime trees in November gold and a yellow tram, under Berlin’s real light. An alternative tried for the homepage hero.',
    },
  },
];
