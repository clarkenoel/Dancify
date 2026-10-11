import star1 from '../assets/rink/star1.png';
import star2 from '../assets/rink/star2.png';
import star3 from '../assets/rink/star3.png';
import star4 from '../assets/rink/star4.png';

// Figma 33:54: four original frames, 300ms each. Decorative only.
export function LoadingStars() {
  return <span className="loading-stars" aria-hidden="true">{[star1, star2, star3, star4].map((src, index) => <img key={src} src={src} alt="" style={{ animationDelay: `${index * .3}s` }} />)}</span>;
}

// Figma 33:102: earned positions 1–4 use star2; position 5 uses star3.
export function ScoreStars({ rating }: { rating: number }) {
  return <div className="score-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <img key={index} src={index === 4 ? star3 : star2} alt="" className={index < rating ? 'earned' : ''} />)}</div>;
}

export function RinkStars() {
  const stars = [[298,190,96,.42],[232,220,66,.31],[323,105,58,.28],[200,145,48,.21],[133,208,50,.14],[273,42,42,.13],[130,103,40,.1],[69,172,34,.07],[201,35,32,.07],[65,54,30,.04]];
  return <div className="rink-stars" aria-hidden="true">{stars.map(([x,y,size,opacity], index) => <img key={index} src={[star1,star2,star3,star4][index % 4]} alt="" style={{ left:x, top:y, width:size, height:size, opacity }} />)}</div>;
}
