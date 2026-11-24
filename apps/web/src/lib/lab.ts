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
    href: '/lab/berlin-3d',
    image: '/lab/berlin-3d.jpg',
    date: '2026-11',
    title: { it: 'Berlino 3D', en: 'Berlin 3D' },
    description: {
      it: "Berlino in ASCII a colori, in three.js: la Sprea, la Fernsehturm, il Duomo, i tigli d'oro di novembre e un tram giallo, sotto la luce reale di Berlino. Si apre vista dall'alto con un obiettivo tilt-shift; premi E e la camera scende in strada per camminarci dentro.",
      en: 'Berlin in coloured ASCII, in three.js: the Spree, the Fernsehturm, the Dom, lime trees in November gold and a yellow tram, under Berlin’s real light. It opens seen from above through a tilt-shift lens; press E and the camera flies down to walk its streets.',
    },
  },
];
