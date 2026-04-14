
import { Competitor, Match, Tournament } from './types';

export const COMPETITORS: Record<string, Competitor> = {
  'c1': { id: 'c1', name: 'S. Ono', country: 'Japan', rank: 1, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDRxSOWCgBms-OcZ_PfpoJjBQQgXzIf7_VpR8kWugCh5STtG8SNrgyCmt3QvL8sFnTK93KreDrH5N-mEnAwb9geiTXKK_t62DsLSwP250S_Y0DTX4NbqY97yEd3TjV9i-Yv0_qCJDH7EFsXs_UvV5aPw5mgQo4xVtR5AneD-ymSDnsblfKvQxj_BVgRICfRfyVwa6QjBBB_FsjekA_NOp91kT28U4D_ABrgN12_6DMoULOAyOC1ctgV6YUdxvqE86XyBvrxRB9ZZrw' },
  'c2': { id: 'c2', name: 'L. Shavdatuashvili', country: 'Georgia', rank: 8, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxg2EZV_TkCfz2mVOeKnh4IQIF1jJzcxvFHosHOUcNNlJBhHAqpq6wn0cIDEXkaGeTfqZ1K-D1H6-wFjkGrFv5Gai1kQxNdfGupyPNxZSgzL7XJ3iSfYqzV238BjyCckzYgQJ5wFtDQ6GkQWKbusBZ47aZUqla_BvwQ5_lHCjOu0Q2-jgG48RAyoOu5EytNyFo4GYUnMQlBC2GMKnj0AEDQaXAfSWMVvooTfywCloU6-swujpN4G_zBQUwkRerYzhRbFtdS5Q2VeY' },
  'c3': { id: 'c3', name: 'H. Heydarov', country: 'Azerbaijan', rank: 4, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAGBLFn7oV-584oO14fUWpv6i6ViNTl6kO3QsxDUZEiWELY12bOJsU8hAVCDNCs5wT90BKMLAt1_-pVmCiyTUTaXKUtPFZdG87hWJlDp0af7ZHBnBakNI4IrbFdbvTRZxTBckXyvfRLMBF_O4eVLC6OEa5PJsZuqO7heUf-hGMChk3CvsvniaLJHm2xzPyFhRL1K1Vc8-ShFfdZEFkuftMta0gS6s04gAWXOrGmXy4MjN2NUBup1GPNGByZheKRCrN6H7mn9uWm6X0' },
  'c4': { id: 'c4', name: 'A. Margelidon', country: 'Canada', rank: 5, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-tGEdDd_ZYaA-CKeBz_1dSMgUp6WQ4ikgOIfD2xMCFsOav-8JZtT138HnmmPJAjm1C-IW5RvJZjsAupOItrmFVaSjOxuqGv162G0XJTMQkVB_yEOJDM0Bp71HjRNAN1pFcE_-7MxmqtarJb4s7RhtJazlxA_EF4YifxsIZP46oFJ-8OylyFtmzoY4rMIrISeVHjWoGYo4StXI0vCMU0gIvQ9oGdoLB1NQh1U7BqL4pQUyqjs50x9ckoALTEIngTvOJXZ3Zb2VxjA' },
  'c5': { id: 'c5', name: 'An Changrim', country: 'Korea', rank: 2, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDsJEw-poDowS5YnAl42riGp011ExsrW6jeY1Wd2Exg2-HMAptM-F7dL42iRW5pAx7ZWJ5Os9Ul07mP0It3MNJ2Rn7l0fXXB9jEGImoP-o6GJ3zIsvm4iKqx54w1IT9TunK-2V7w70Bx0z2Xl9XweJimOqJRzRAAdRK2BnwRmhVYoZFpqJAg32Y8KLUTwtSOwf4wJN4J3PEHyzE-WZUPbfjHZZ14YsO0YgcQsU2l_sGIDx-JhlCl4c8dhWT_TrF6vRNIthYcuXFFA8' },
  'c6': { id: 'c6', name: 'Ts. Tsend-Ochir', country: 'Mongolia', rank: 7, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD2uBYlDfX9_sCg_a49Kn5YlMREmy9HsdgFLuhbE-Tu4yUA6RcY1Dm0F7uwj4Kn38_PxTAwHdR7OvJraVdLF3HHoFnmseBSCeTYCIBQRuzdh2TvTE4_uN32McjSYB-xDLrKDOSDIYmSevJmuT0aHMsYK7uw9gUgUgIGsCIvptS7m5tp_1J0FrcRwCoBWVvcgOgaqk5iXI8hoIGFHQVcZhHtWxgx6rGuTPS1G462PkUXJljz4aoPn_Yq33XfQf10HbtaEXWo2S7niww' },
  'c7': { id: 'c7', name: 'D. Cargnin', country: 'Brazil', rank: 3, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCCFUII45eCp8yCRj861CLruTZz4k9Az2mXIcoYWLlksQBEy7R1x291XzrFroasJGNCMw-C6eonMi6RPVKVgJ1hENXRFeu5b3Ztdlb2HU7ly3NjspfZ900WSQINV3KOyM9Olt8Gw8_EkrXTIRcRnQps15k-K-z7PcpbnGx-bJycCiqg8FBGOjRlF_iWp6HKwhGI-g42D22oEPqyqs8dd3pKGyf54JZiw2iUFm7OQEmaKvHsBTcmjY8Lyp95X5cbxznpKsoIwEocM6k' },
  'c8': { id: 'c8', name: 'F. Basile', country: 'Italy', rank: 6, flagUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBBjxZ92Y-fepo_hGPZS6ZbAdNy1JQ-NQLZxV1DuS3rsLgZfEjrrfYtdzkRrW9jJyDvA5UzYPQs0xCOBo1aFUh9TkIb6CTYx3M0yWfK1BJ5CvbpoKpoPXCqL9hH69PdzDsjOugK8WxTvq4-_WFccFu-WS0XILXyjNy0MbYv8Iq7uiAxwl4bX1oNZ-nGxUSxeSTk0ASPng6Q7k1p2a3prUrpcLaZa395eDlivpOumnH9B-rPy8c8oTqDz0T1uEjN1QdNk99ElpXqkjU' },
};

export const INITIAL_MATCHES: Match[] = [
  // Round 1 - QF
  { id: 'm1', round: 'QF', matchNumber: 1, pool: 'A', competitor1: COMPETITORS['c1'], competitor2: COMPETITORS['c2'], winnerId: null, nextMatchId: 'm5', nextMatchSlot: 1 },
  { id: 'm2', round: 'QF', matchNumber: 2, pool: 'A', competitor1: COMPETITORS['c3'], competitor2: COMPETITORS['c4'], winnerId: null, nextMatchId: 'm5', nextMatchSlot: 2 },
  { id: 'm3', round: 'QF', matchNumber: 3, pool: 'B', competitor1: COMPETITORS['c5'], competitor2: COMPETITORS['c6'], winnerId: null, nextMatchId: 'm6', nextMatchSlot: 1 },
  { id: 'm4', round: 'QF', matchNumber: 4, pool: 'B', competitor1: COMPETITORS['c7'], competitor2: COMPETITORS['c8'], winnerId: null, nextMatchId: 'm6', nextMatchSlot: 2 },
  // Round 2 - SF
  { id: 'm5', round: 'SF', matchNumber: 5, pool: 'A', competitor1: null, competitor2: null, winnerId: null, nextMatchId: 'm7', nextMatchSlot: 1 },
  { id: 'm6', round: 'SF', matchNumber: 6, pool: 'B', competitor1: null, competitor2: null, winnerId: null, nextMatchId: 'm7', nextMatchSlot: 2 },
  // Round 3 - Final
  { id: 'm7', round: 'F', matchNumber: 7, competitor1: null, competitor2: null, winnerId: null },
];

export const SAMPLE_TOURNAMENTS: Tournament[] = [
  { 
    id: 't1', 
    name: 'Paris Grand Slam 2024', 
    location: 'Paris, France', 
    date: '2024-02-02', 
    status: 'LIVE', 
    completion: 65,
    participantCount: 380,
    categories: {
        male: ['-60kg', '-66kg', '-73kg', '-81kg', '-90kg', '-100kg', '+100kg'],
        female: ['-48kg', '-52kg', '-57kg', '-63kg', '-70kg', '-78kg', '+78kg']
    },
    roster: Object.values(COMPETITORS) // Adding mock roster for visual tests
  },
  { 
    id: 't2', 
    name: 'Tashkent Grand Slam', 
    location: 'Tashkent, Uzbekistan', 
    date: '2024-03-01', 
    status: 'SORTING', 
    completion: 0,
    participantCount: 412,
    categories: {
        male: ['-60kg', '-66kg', '-73kg', '-81kg'],
        female: ['-48kg', '-52kg', '-57kg', '-63kg']
    },
    roster: Object.values(COMPETITORS)
  },
  { 
    id: 't3', 
    name: 'World Championships', 
    location: 'Abu Dhabi, UAE', 
    date: '2024-05-19', 
    status: 'DRAFT', 
    completion: 0,
    participantCount: 120,
    categories: {
        male: ['-100kg', '+100kg'],
        female: ['-78kg', '+78kg']
    },
    roster: Object.values(COMPETITORS)
  },
];
