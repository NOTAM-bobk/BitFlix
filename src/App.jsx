import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// --- Constants ---
const TMDB_KEY = 'b1941699110de014fceb3d15828f4718';
const BASE = 'https://api.themoviedb.org/3';
const IMG_POSTER = 'https://image.tmdb.org/t/p/w400';
const IMG_BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const IMG_BACKDROP_SM = 'https://image.tmdb.org/t/p/w780';

// --- TMDB API Wrapper with Cache/Queue ---
const _tmdbCache = new Map();
const _tmdbInFlight = new Map();
const _tmdbQueue = [];
let _tmdbActive = 0;
const TMDB_CONCURRENCY = 4;

const _tmdbDrain = () => {
  while (_tmdbActive < TMDB_CONCURRENCY && _tmdbQueue.length) {
    const { url, resolve, reject } = _tmdbQueue.shift();
    _tmdbActive++;
    (async () => {
      try {
        let res = await fetch(url);
        if (res.status === 429) {
          const w = Number(res.headers.get('Retry-After') || 2) * 1000;
          await new Promise(r => setTimeout(r, w));
          res = await fetch(url);
        }
        if (!res.ok) throw new Error('TMDB ' + res.status);
        const json = await res.json();
        _tmdbCache.set(url, json);
        _tmdbInFlight.delete(url);
        resolve(json);
      } catch (e) {
        _tmdbInFlight.delete(url);
        reject(e);
      } finally {
        _tmdbActive--;
        _tmdbDrain();
      }
    })();
  }
};

const tmdb = (path, params = {}) => {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const key = url.toString();
  if (_tmdbCache.has(key)) return Promise.resolve(_tmdbCache.get(key));
  if (_tmdbInFlight.has(key)) return _tmdbInFlight.get(key);
  const p = new Promise((resolve, reject) => _tmdbQueue.push({ url: key, resolve, reject }));
  _tmdbInFlight.set(key, p);
  _tmdbDrain();
  return p;
};

const imgUrl = (path, size) => (path ? size + path : null);
const mTitle = i => i.title || i.name || 'Untitled';
const mYear = i => {
  const d = i.release_date || i.first_air_date;
  return d ? d.slice(0, 4) : '—';
};
const mType = i => i.media_type || (i.first_air_date ? 'tv' : 'movie');

// --- Main Component ---
export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [category, setCategory] = useState('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [modalData, setModalData] = useState(null);
  const [playerData, setPlayerData] = useState(null);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [exploreFilter, setExploreFilter] = useState('trending');
  const [catOverlay, setCatOverlay] = useState(null);
  const [toast, setToast] = useState(null);

  const searchInputRef = useRef(null);

  // --- Initialization & Listeners ---
  useEffect(() => {
    // Intro
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 3500);

    // Local Storage
    setRecentSearches(JSON.parse(localStorage.getItem('netflix_recent') || '[]'));
    setWatchlist(JSON.parse(localStorage.getItem('velvet_watchlist') || '[]'));
    setContinueWatching(JSON.parse(localStorage.getItem('cw_list') || '[]'));

    // Scroll
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll);

    // Escape Key
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (playerData) setPlayerData(null);
        else if (modalData) setModalData(null);
        else if (exploreOpen) setExploreOpen(false);
        else if (catOverlay) setCatOverlay(null);
        else if (searchOpen) setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKey);
    };
  }, [playerData, modalData, exploreOpen, catOverlay, searchOpen]);

  // --- Actions ---
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const toggleWatchlist = (item) => {
    const isListed = watchlist.some(i => i.id === item.id && i.media_type === mType(item));
    let newList;
    if (isListed) {
      newList = watchlist.filter(i => !(i.id === item.id && i.media_type === mType(item)));
      showToast('Removed from My List');
    } else {
      newList = [{ ...item, media_type: mType(item) }, ...watchlist];
      showToast('Added to My List');
    }
    setWatchlist(newList);
    localStorage.setItem('velvet_watchlist', JSON.stringify(newList));
  };

  const addToCW = (item) => {
    let list = continueWatching.filter(i => !(i.id === item.id && i.media_type === mType(item)));
    list.unshift({ ...item, media_type: mType(item), watchedAt: Date.now(), progress: item.progress || Math.floor(Math.random() * 70) + 5 });
    const sliced = list.slice(0, 20);
    setContinueWatching(sliced);
    localStorage.setItem('cw_list', JSON.stringify(sliced));
  };

  const removeFromCW = (id, type) => {
    const newList = continueWatching.filter(i => !(i.id === id && i.media_type === type));
    setContinueWatching(newList);
    localStorage.setItem('cw_list', JSON.stringify(newList));
  };

  const openPlayer = (url, label, cwItem) => {
    setPlayerData({ url, label });
    if (cwItem) addToCW(cwItem);
  };

  const openModal = async (id, type, opts = {}) => {
    setModalData({ loading: true });
    try {
      const data = await tmdb(`/${type}/${id}`, { append_to_response: 'videos,credits,similar' });
      setModalData({ ...data, type, opts });
    } catch (e) {
      setModalData({ error: true });
    }
  };

  const runSearch = async (q) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    // Add to recent
    let l = recentSearches.filter(i => i.toLowerCase() !== q.toLowerCase());
    l.unshift(q);
    const sliced = l.slice(0, 8);
    setRecentSearches(sliced);
    localStorage.setItem('netflix_recent', JSON.stringify(sliced));

    try {
      const d = await tmdb('/search/multi', { query: q, include_adult: 'false' });
      setSearchResults((d.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv'));
    } catch (e) {
      setSearchResults([]);
    }
  };

  const handleSearchInput = (val) => {
    setSearchQuery(val);
    if (!val.trim()) setSearchResults([]);
  };

  // --- Sub-Components ---

  const Card = ({ item, type }) => {
    const poster = imgUrl(item.poster_path, IMG_POSTER);
    const itype = type || mType(item);
    return (
      <div className="card" onClick={() => openModal(item.id, itype)}>
        {poster ? <img loading="lazy" src={poster} alt={mTitle(item)} /> : <div className="card-fallback">{mTitle(item)}</div>}
        <div className="card-meta">
          <div>{mTitle(item)}</div>
          <div><span className="r">★ {item.vote_average ? item.vote_average.toFixed(1) : '–'}</span> · {mYear(item)}</div>
        </div>
      </div>
    );
  };

  const Row = ({ title, fetcher, type, expandCfg }) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      fetcher().then(d => {
        setItems(d.results || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }, [fetcher]);

    if (!loading && items.length === 0) return null;

    return (
      <div className="row">
        <div className="row-head">
          <div className="row-title">{title}</div>
          {expandCfg && (
            <button className="row-expand-btn" onClick={() => setCatOverlay({ title, ...expandCfg })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          )}
        </div>
        <div className="row-track">
          {loading ? Array(8).fill(0).map((_, i) => <div key={i} className="skel" />) : items.map(item => <Card key={item.id} item={item} type={type} />)}
        </div>
      </div>
    );
  };

  const Hero = () => {
    const [items, setItems] = useState([]);
    const [index, setIndex] = useState(0);
    const timerRef = useRef(null);

    useEffect(() => {
      tmdb('/trending/all/week').then(d => {
        setItems((d.results || []).filter(i => i.backdrop_path).slice(0, 5));
      });
    }, []);

    useEffect(() => {
      if (items.length) {
        timerRef.current = setInterval(() => {
          setIndex(prev => (prev + 1) % items.length);
        }, 8000);
      }
      return () => clearInterval(timerRef.current);
    }, [items]);

    if (!items.length) return <header className="hero"><div className="hero-content"><h1 className="hero-title">Loading…</h1></div></header>;

    const item = items[index];
    return (
      <header className="hero">
        <div className="hero-scrim"></div>
        {items.map((it, i) => (
          <div key={it.id} className={`hero-slide ${i === index ? 'active' : ''}`} style={{ backgroundImage: `url(${imgUrl(it.backdrop_path, IMG_BACKDROP)})` }} />
        ))}
        <div className="hero-content">
          <h1 className="hero-title">{mTitle(item)}</h1>
          <div className="hero-meta">
            <span className="rating">★ {item.vote_average ? item.vote_average.toFixed(1) : '–'}</span>
            <span>{mYear(item)}</span>
            <span>{mType(item) === 'tv' ? 'Series' : 'Film'}</span>
          </div>
          <p className="hero-overview">{item.overview}</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => openModal(item.id, mType(item), { autoplayTrailer: true })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Play Trailer
            </button>
            <button className="btn btn-ghost" onClick={() => openModal(item.id, mType(item))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              More Info
            </button>
          </div>
        </div>
        <div className="hero-dots">
          {items.map((_, i) => (
            <button key={i} className={i === index ? 'active' : ''} onClick={() => { setIndex(i); clearInterval(timerRef.current); }} />
          ))}
        </div>
      </header>
    );
  };

  const StreamFinder = () => {
    const providers = [
      { id: 8, name: 'Netflix', hex: '#E50914', logo: '/t8t3S9Il9m9RpU9SMRYq6G4YInS.jpg' },
      { id: 9, name: 'Prime Video', hex: '#00A8E1', logo: '/em8be9P4Fs6DlQixvFOz7GHOo9S.jpg' },
      { id: 15, name: 'Hulu', hex: '#1CE783', logo: '/zxrV9Yp80Uf7ZpX7V9S8S8S8S8S.jpg' }, // Placeholder paths
      { id: 337, name: 'Disney+', hex: '#2D6BFF', logo: '/7rwE0v2Uen5pSTr7oP9S8S8S8S8.jpg' },
      { id: 1899, name: 'Max', hex: '#6B5BFF', logo: '/68vAnDy9S8S8S8S8S8S8S8S8S8S.jpg' },
      { id: 350, name: 'Apple TV+', hex: '#C7C7C7', logo: '/68vAnDy9S8S8S8S8S8S8S8S8S8S.jpg' },
    ];
    // For simplicity, using hardcoded IDs from the original script logic
    const [selected, setSelected] = useState(8);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      setLoading(true);
      Promise.all([
        fetch(`${BASE}/discover/movie?api_key=${TMDB_KEY}&watch_region=US&with_watch_providers=${selected}&sort_by=popularity.desc&page=1`).then(r => r.json()),
        fetch(`${BASE}/discover/tv?api_key=${TMDB_KEY}&watch_region=US&with_watch_providers=${selected}&sort_by=popularity.desc&page=1`).then(r => r.json())
      ]).then(([md, td]) => {
        const combined = [];
        const m = (md.results || []).map(i => ({ ...i, media_type: 'movie' }));
        const t = (td.results || []).map(i => ({ ...i, media_type: 'tv' }));
        for (let i = 0; i < 20; i++) {
          if (m[i]) combined.push(m[i]);
          if (t[i]) combined.push(t[i]);
        }
        setItems(combined);
        setLoading(false);
      }).catch(() => setLoading(false));
    }, [selected]);

    return (
      <section className="sf-section">
        <div className="sf-section-label">Browse by Platform · US</div>
        <div className="sf-providers">
          {providers.map(p => (
            <button key={p.id} className={`sf-provider-btn ${selected === p.id ? 'active' : ''}`} onClick={() => setSelected(p.id)}>
              <div className="sf-provider-tile" style={selected === p.id ? { borderColor: p.hex, boxShadow: `0 0 24px ${p.hex}80` } : {}}>
                <div className="sf-provider-fallback" style={{ color: p.hex, background: `${p.hex}22` }}>{p.name[0]}</div>
              </div>
              <div className="sf-provider-name">{p.name}</div>
              <div className="sf-provider-dot" style={{ background: p.hex }}></div>
            </button>
          ))}
        </div>
        <div className="sf-results-row">
          <div className="sf-row-head">
            <div className="row-title">Streaming Now</div>
          </div>
          <div className="row-track">
            {loading ? Array(8).fill(0).map((_, i) => <div key={i} className="skel" />) : items.map(item => <Card key={item.id + item.media_type} item={item} />)}
          </div>
        </div>
      </section>
    );
  };

  const Modal = () => {
    if (!modalData) return null;
    const [season, setSeason] = useState(1);
    const [episodes, setEpisodes] = useState([]);
    const [epLoading, setEpLoading] = useState(false);

    useEffect(() => {
      if (modalData.type === 'tv' && !modalData.loading) {
        setEpLoading(true);
        tmdb(`/tv/${modalData.id}/season/${season}`).then(d => {
          setEpisodes(d.episodes || []);
          setEpLoading(false);
        }).catch(() => setEpLoading(false));
      }
    }, [season, modalData]);

    if (modalData.loading) return (
      <div className="modal-backdrop show" onClick={() => setModalData(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
            <div style={{ padding: '80px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading…</div>
          </div>
        </div>
      </div>
    );

    const trailer = (modalData.videos?.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer') || (modalData.videos?.results || []).find(v => v.site === 'YouTube');
    const listed = watchlist.some(i => i.id === modalData.id && i.media_type === modalData.type);

    return (
      <div className="modal-backdrop show" onClick={() => setModalData(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal-drag-handle"><div className="bar"></div></div>
          <div className="modal-scroll">
            <div className="modal-hero" style={{ backgroundImage: `url(${imgUrl(modalData.backdrop_path, IMG_BACKDROP_SM)})` }}>
              <button className="modal-close" onClick={() => setModalData(null)}>✕</button>
              <div className="modal-title-wrap"><div className="modal-title">{mTitle(modalData)}</div></div>
            </div>
            <div className="modal-body">
              <div className="modal-meta">
                <span style={{ color: 'var(--gold)', fontWeight: 700 }}>★ {modalData.vote_average?.toFixed(1)}</span>
                <span>{mYear(modalData)}</span>
                {modalData.type === 'movie' ? <span>{modalData.runtime} min</span> : <span>{modalData.number_of_seasons} Seasons</span>}
              </div>
              <div className="pills">{(modalData.genres || []).map(g => <span key={g.id} className="pill">{g.name}</span>)}</div>
              <div className="modal-actions">
                <button className="btn btn-play" onClick={() => openPlayer(modalData.type === 'movie' ? `https://vidfast.pro/movie/${modalData.id}` : `https://vidfast.pro/tv/${modalData.id}/1/1`, mTitle(modalData), modalData)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  {modalData.type === 'tv' ? 'Play S1 E1' : 'Play'}
                </button>
                <button className="btn btn-primary" disabled={!trailer} onClick={() => {
                  const f = document.getElementById('trailerFrame');
                  f.classList.add('show');
                  f.innerHTML = `<iframe src="https://www.youtube.com/embed/${trailer.key}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  {trailer ? 'Trailer' : 'No Trailer'}
                </button>
                <button className="btn btn-ghost" onClick={() => toggleWatchlist(modalData)}>{listed ? '✓ In My List' : '+ My List'}</button>
              </div>
              <div className="trailer-frame" id="trailerFrame"></div>
              <p className="modal-overview">{modalData.overview}</p>
              <div className="cast-label">Cast</div>
              <div className="cast-list">{(modalData.credits?.cast || []).slice(0, 5).map(c => c.name).join(', ')}</div>

              {modalData.type === 'tv' && (
                <div className="episodes-wrap">
                  <div className="episodes-head">
                    <div className="cast-label" style={{ marginBottom: 0 }}>Episodes</div>
                    <select className="season-select" value={season} onChange={e => setSeason(e.target.value)}>
                      {(modalData.seasons || []).filter(s => s.season_number !== 0).map(s => <option key={s.id} value={s.season_number}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="episode-list">
                    {epLoading ? <div className="episode-loading">Loading episodes…</div> : episodes.map(ep => (
                      <div key={ep.id} className="episode-item">
                        <div className="episode-num">{ep.episode_number}</div>
                        <div className="episode-still">
                          <img src={imgUrl(ep.still_path, IMG_BACKDROP_SM)} alt={ep.name} />
                          <div className="episode-play-overlay" onClick={() => openPlayer(`https://vidfast.pro/tv/${modalData.id}/${season}/${ep.episode_number}`, `${mTitle(modalData)} · S${season} E${ep.episode_number}`, { ...modalData, lastEp: `S${season} E${ep.episode_number}` })}>
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                          </div>
                        </div>
                        <div className="episode-info">
                          <div className="episode-title">{ep.name}</div>
                          <div className="episode-meta">{ep.air_date} · {ep.runtime} min</div>
                          <div className="episode-overview">{ep.overview}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="more-like-this">
                <div className="mlt-label">More Like This</div>
                <div className="mlt-grid">
                  {(modalData.similar?.results || []).slice(0, 12).map(it => (
                    <div key={it.id} className="mlt-card" onClick={() => openModal(it.id, mType(it))}>
                      <img src={imgUrl(it.poster_path, IMG_POSTER)} alt={mTitle(it)} />
                      <div className="mlt-card-title">{mTitle(it)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="note">Streaming via vidfast.pro, a third-party source. Availability varies by region.</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const Player = () => {
    if (!playerData) return null;
    return (
      <div className="player-popup show" onClick={() => setPlayerData(null)}>
        <div className="player-top-bar" onClick={e => e.stopPropagation()}>
          <div className="player-label">{playerData.label}</div>
          <button className="player-close" onClick={() => setPlayerData(null)}>✕</button>
        </div>
        <div className="player-wrap" onClick={e => e.stopPropagation()}>
          <iframe src={playerData.url} allowFullScreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>
        </div>
        <div className="player-disclaimer" onClick={e => e.stopPropagation()}>
          <svg className="player-disclaimer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="player-disclaimer-text"><strong>Heads up:</strong> The first thing you click on the player will redirect you to a new page — don't worry, it's safe.</span>
        </div>
      </div>
    );
  };

  const ExploreOverlay = () => {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (!exploreOpen) return;
      setLoading(true);
      const filters = {
        trending: () => tmdb('/trending/all/week', { page }),
        movies: () => tmdb('/movie/popular', { page }),
        tv: () => tmdb('/tv/popular', { page }),
        top_rated: () => tmdb('/movie/top_rated', { page }),
        action: () => tmdb('/discover/movie', { with_genres: 28, sort_by: 'popularity.desc', page }),
        comedy: () => tmdb('/discover/movie', { with_genres: 35, sort_by: 'popularity.desc', page }),
        scifi: () => tmdb('/discover/movie', { with_genres: 878, sort_by: 'popularity.desc', page }),
        horror: () => tmdb('/discover/movie', { with_genres: 27, sort_by: 'popularity.desc', page }),
        drama: () => tmdb('/discover/movie', { with_genres: 18, sort_by: 'popularity.desc', page }),
        animation: () => tmdb('/discover/movie', { with_genres: 16, sort_by: 'popularity.desc', page }),
      };
      filters[exploreFilter]().then(d => {
        setItems(prev => page === 1 ? d.results : [...prev, ...d.results]);
        setLoading(false);
      });
    }, [exploreOpen, exploreFilter, page]);

    if (!exploreOpen) return null;

    return (
      <div className="explore-overlay show">
        <div className="explore-header">
          <div className="explore-header-inner">
            <div className="explore-title">Explore Titles</div>
            <div className="explore-filters">
              {['trending', 'movies', 'tv', 'top_rated', 'action', 'comedy', 'scifi', 'horror', 'drama', 'animation'].map(f => (
                <button key={f} className={`explore-filter ${exploreFilter === f ? 'active' : ''}`} onClick={() => { setExploreFilter(f); setPage(1); }}>{f.replace('_', ' ').toUpperCase()}</button>
              ))}
            </div>
          </div>
          <button className="explore-close" onClick={() => setExploreOpen(false)}>✕</button>
        </div>
        <div className="explore-scroll" onScroll={e => {
          if (e.target.scrollHeight - e.target.scrollTop === e.target.clientHeight && !loading) setPage(p => p + 1);
        }}>
          <div className="explore-grid">
            {items.map(it => <Card key={it.id} item={it} />)}
          </div>
          {loading && <div className="explore-load-trigger"><div className="explore-spinner" /></div>}
        </div>
      </div>
    );
  };

  const CatOverlay = () => {
    if (!catOverlay) return null;
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      setLoading(true);
      catOverlay.fn(page).then(d => {
        setItems(prev => page === 1 ? d.results : [...prev, ...d.results]);
        setLoading(false);
      });
    }, [page, catOverlay]);

    return (
      <div className="cat-overlay show">
        <div className="cat-header">
          <div className="cat-title">{catOverlay.title}</div>
          <button className="cat-close" onClick={() => setCatOverlay(null)}>✕</button>
        </div>
        <div className="cat-scroll" onScroll={e => {
          if (e.target.scrollHeight - e.target.scrollTop === e.target.clientHeight && !loading) setPage(p => p + 1);
        }}>
          <div className="cat-grid">
            {items.map(it => <Card key={it.id} item={it} type={catOverlay.type} />)}
          </div>
          {loading && <div className="cat-load-trigger"><div className="cat-spinner" style={{ display: 'block' }} /></div>}
        </div>
      </div>
    );
  };

  return (
    <>
      {showIntro && (
        <div id="introOverlay">
          <div id="introContainer">
            <div className="netflix-intro-static">N</div>
          </div>
        </div>
      )}

      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="logo" onClick={() => setCategory('home')}>Netflix</div>
        <div className="nav-links">
          <a href="#" className={category === 'home' ? 'active' : ''} onClick={() => setCategory('home')}>Home</a>
          <a href="#" className={category === 'movies' ? 'active' : ''} onClick={() => setCategory('movies')}>Movies</a>
          <a href="#" className={category === 'tv' ? 'active' : ''} onClick={() => setCategory('tv')}>TV Shows</a>
          <a href="#" className={category === 'mylist' ? 'active' : ''} onClick={() => setCategory('mylist')}>My List</a>
        </div>
        <div className="nav-right">
          <div className="search-wrap">
            <button className={`icon-btn ${searchOpen ? 'active' : ''}`} onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            <div className={`search-panel ${searchOpen ? 'open' : ''}`}>
              <div className="search-field">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input ref={searchInputRef} value={searchQuery} onChange={e => handleSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch(searchQuery)} placeholder="Titles, people, genres…" />
                {searchQuery && <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>✕</button>}
              </div>
              {!searchQuery && (
                <div className="recent-wrap">
                  <div className="recent-head"><span>Recent Searches</span><button onClick={() => { setRecentSearches([]); localStorage.setItem('netflix_recent', '[]'); }}>Clear</button></div>
                  <div className="recent-list">
                    {recentSearches.map(q => (
                      <div key={q} className="recent-item" onClick={() => { setSearchQuery(q); runSearch(q); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg><span>{q}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {searchResults.length > 0 ? (
        <section className="search-view show">
          <h2 className="search-heading">Results for "{searchQuery}"</h2>
          <div className="search-grid">{searchResults.map(it => <Card key={it.id} item={it} />)}</div>
        </section>
      ) : (
        <>
          {category === 'home' && <Hero />}

          <main className="rows">
            {continueWatching.length > 0 && category === 'home' && (
              <div className="row">
                <div className="row-head"><div className="row-title">Continue Watching</div></div>
                <div className="row-track">
                  {continueWatching.map(item => (
                    <div key={item.id + item.media_type} className="cw-card">
                      <div className="cw-thumb" onClick={() => openModal(item.id, item.media_type)}>
                        <img src={imgUrl(item.backdrop_path || item.poster_path, IMG_BACKDROP_SM)} alt={mTitle(item)} />
                        <div className="cw-play-overlay" onClick={(e) => { e.stopPropagation(); openPlayer(item.media_type === 'movie' ? `https://vidfast.pro/movie/${item.id}` : `https://vidfast.pro/tv/${item.id}/1/1`, mTitle(item), item); }}>
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                        <div className="cw-progress-bar"><div className="cw-progress-fill" style={{ width: `${item.progress}%` }}></div></div>
                      </div>
                      <div className="cw-info">
                        <div className="cw-title">{mTitle(item)}</div>
                        <div className="cw-sub">{item.media_type === 'tv' ? (item.lastEp || 'Season 1') : 'Movie'}</div>
                      </div>
                      <button className="cw-remove" onClick={() => removeFromCW(item.id, item.media_type)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(category === 'home' || category === 'mylist') && watchlist.length > 0 && (
              <div className="row">
                <div className="row-head"><div className="row-title">My List</div></div>
                <div className="row-track">{watchlist.map(it => <Card key={it.id} item={it} />)}</div>
              </div>
            )}

            {category === 'home' && (
              <Row title="Top 10 Today" fetcher={() => tmdb('/trending/all/day')} />
            )}

            {(category === 'home' || category === 'movies') && (
              <>
                <StreamFinder />
                <Row title="Trending Now" fetcher={() => tmdb('/trending/all/week')} type="movie" expandCfg={{ fn: p => tmdb('/trending/all/week', { page: p }), type: 'movie' }} />
                <Row title="Popular Movies" fetcher={() => tmdb('/movie/popular')} type="movie" expandCfg={{ fn: p => tmdb('/movie/popular', { page: p }), type: 'movie' }} />
                <Row title="Action & Adventure" fetcher={() => tmdb('/discover/movie', { with_genres: 28, sort_by: 'popularity.desc' })} type="movie" expandCfg={{ fn: p => tmdb('/discover/movie', { with_genres: 28, sort_by: 'popularity.desc', page: p }), type: 'movie' }} />
                <Row title="Sci-Fi & Fantasy" fetcher={() => tmdb('/discover/movie', { with_genres: 878, sort_by: 'popularity.desc' })} type="movie" expandCfg={{ fn: p => tmdb('/discover/movie', { with_genres: 878, sort_by: 'popularity.desc', page: p }), type: 'movie' }} />
              </>
            )}

            {(category === 'home' || category === 'tv') && (
              <>
                <Row title="Popular TV Shows" fetcher={() => tmdb('/tv/popular')} type="tv" expandCfg={{ fn: p => tmdb('/tv/popular', { page: p }), type: 'tv' }} />
                <Row title="Trending Series" fetcher={() => tmdb('/trending/tv/week')} type="tv" expandCfg={{ fn: p => tmdb('/trending/tv/week', { page: p }), type: 'tv' }} />
                <Row title="Drama Series" fetcher={() => tmdb('/discover/tv', { with_genres: 18, sort_by: 'popularity.desc' })} type="tv" expandCfg={{ fn: p => tmdb('/discover/tv', { with_genres: 18, sort_by: 'popularity.desc', page: p }), type: 'tv' }} />
              </>
            )}
          </main>

          {category !== 'mylist' && (
            <div className="explore-btn-wrap">
              <button className="explore-btn" onClick={() => setExploreOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /><path d="M2 12h2M20 12h2M12 2v2M12 20v2" /></svg>
                Explore More Titles
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          )}
        </>
      )}

      <footer className="footer">
        <div className="sprocket long"><span></span><span></span><span></span><span></span><span></span></div>
        <div>Personal, non-commercial project using TMDB API. Not affiliated with Netflix, Inc. or TMDB.</div>
      </footer>

      <nav className="bottom-nav">
        <button className={category === 'movies' ? 'active' : ''} onClick={() => setCategory('movies')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M7 3v18M17 3v18M2 9h5M17 9h5M2 15h5M17 15h5" /></svg>
          <span>Movies</span>
        </button>
        <button className={category === 'tv' ? 'active' : ''} onClick={() => setCategory('tv')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M9 21h6M12 19v2" /></svg>
          <span>Shows</span>
        </button>
        <button className={category === 'mylist' ? 'active' : ''} onClick={() => setCategory('mylist')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
          <span>Watchlist</span>
        </button>
      </nav>

      <Modal />
      <Player />
      <ExploreOverlay />
      <CatOverlay />
      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}
