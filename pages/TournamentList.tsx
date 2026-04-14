
import React, { useState, useEffect } from 'react';
import { ViewState, UserRole, Tournament } from '../types';
import { Plus, Calendar, ChevronRight, Users, Edit3, Lock, Trash2, Gamepad2 } from 'lucide-react';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';

interface TournamentListProps {
  onNavigate: (view: ViewState) => void;
  userRole: UserRole;
  tournaments: Tournament[];
  onSelectTournament: (t: Tournament) => void;
  onEditTournament?: (t: Tournament) => void;
  onDeleteTournament?: (t: Tournament) => void;
  onCreateNew?: () => void;
}

const TournamentList: React.FC<TournamentListProps> = ({ 
  onNavigate, 
  userRole, 
  tournaments, 
  onSelectTournament,
  onEditTournament,
  onDeleteTournament,
  onCreateNew
}) => {
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchPlayerCounts = async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        tournaments.map(async (t) => {
          try {
            const { count, error } = await supabase
              .from('user_picks')
              .select('user_id', { count: 'exact', head: true })
              .eq('tournament_id', t.id);
            if (!error) counts[t.id] = count || 0;
          } catch { /* table may not exist */ }
        })
      );
      setPlayerCounts(counts);
    };

    if (tournaments.length > 0) fetchPlayerCounts();
  }, [tournaments]);

  const handleTournamentClick = (t: Tournament) => {
    onSelectTournament(t);
    const status = (t.status || '').toUpperCase();
    
    // Updated Logic: Treat UPCOMING and COMING_SOON as draft-like states for navigation purposes (Go to Roster, not Bracket)
    if (status === 'DRAFT' || status === 'UPCOMING' || status === 'COMING_SOON') {
        onNavigate('ROSTER');
    } else {
        onNavigate('BRACKET');
    }
  };

  const handleEditClick = (e: React.MouseEvent, t: Tournament) => {
      e.stopPropagation();
      if (onEditTournament) onEditTournament(t);
  };

  const handleDeleteClick = (e: React.MouseEvent, t: Tournament) => {
      e.stopPropagation();
      if (onDeleteTournament) onDeleteTournament(t);
  };

  const handleCreateClick = () => {
      if (onCreateNew) onCreateNew();
      else onNavigate('CREATE_TOURNAMENT');
  };

  // --- SPANISH DATE FORMATTER (Safe Parse) ---
  const formatTournamentDate = (dateString: string | undefined) => {
     if (!dateString) return 'Fecha TBD';
     
     // Tomamos solo la parte YYYY-MM-DD para evitar que JavaScript aplique zonas horarias
     const parts = dateString.split('T')[0].split('-');
     const year = parseInt(parts[0], 10);
     const month = parseInt(parts[1], 10);
     const day = parseInt(parts[2], 10);
     
     // Creamos la fecha usando el constructor local (mes es 0-indexed, por eso -1)
     const date = new Date(year, month - 1, day);
     
     return date.toLocaleDateString('es-ES', { 
       month: 'long', 
       day: 'numeric', 
       year: 'numeric' 
     }).replace(/^\w/, (c) => c.toUpperCase());
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tournaments</h1>
          <p className="text-slate-500 font-medium mt-2">Select a tournament to view brackets or manage events.</p>
        </div>
        {userRole === 'ADMIN' && (
             <Button 
                onClick={handleCreateClick}
                icon={Plus}
                variant="primary"
             >
                Create Tournament
             </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
         {tournaments.map((t, index) => {
             const status = (t.status || '').toUpperCase();
             // Broaden Definition of 'Draft' for UI Styling
             const isDraft = status === 'DRAFT' || status === 'UPCOMING' || status === 'COMING_SOON';
             const formattedDate = formatTournamentDate(t.date);

             return (
             <div 
                key={t.id} 
                onClick={() => handleTournamentClick(t)}
                style={{ animationDelay: `${index * 100}ms` }}
                className="bg-white rounded-xl shadow-zen border border-slate-100 p-6 cursor-pointer group hover:border-primary/50 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 opacity-0 animate-fade-in-up relative overflow-hidden"
             >
                 <div className="flex justify-between items-start mb-4 relative z-10">
                     <div className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md ${
                         status === 'LIVE' ? 'bg-red-50 text-red-600 animate-pulse' : 
                         status === 'SORTING' ? 'bg-blue-50 text-blue-600' :
                         (status === 'UPCOMING' || status === 'COMING_SOON') ? 'bg-yellow-100 text-yellow-800' :
                         status === 'DRAFT' ? 'bg-slate-200 text-slate-600 border border-slate-300 border-dashed' :
                         'bg-slate-100 text-slate-600'
                     }`}>
                         {status === 'UPCOMING' ? 'Upcoming' : (status === 'DRAFT' ? 'Draft' : status)}
                     </div>
                     <div className="text-slate-300 group-hover:text-primary transition-colors transform group-hover:translate-x-1">
                         <ChevronRight size={20} />
                     </div>
                 </div>
                 
                 <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-primary transition-colors relative z-10">{t.name}</h3>
                 
                 <div className="flex flex-col gap-2 mb-6 relative z-10">
                     <div className="flex items-center gap-2 text-slate-500 text-sm">
                         <Calendar size={16} />
                         <span>{formattedDate}</span>
                     </div>
                     <div className="flex items-center gap-2 text-slate-500 text-sm">
                         <Users size={16} />
                         <span>{t.participantCount || 0} Judokas</span>
                     </div>
                     {(playerCounts[t.id] ?? 0) > 0 && (
                       <div className="flex items-center gap-2 text-purple-500 text-sm">
                         <Gamepad2 size={16} />
                         <span>{playerCounts[t.id]} jugador{playerCounts[t.id] !== 1 ? 'es' : ''}</span>
                       </div>
                     )}
                 </div>
                 
                 <div className="mb-4 flex flex-wrap gap-1 relative z-10">
                    {t.categories?.male && t.categories.male.length > 0 && (
                        <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">M: {t.categories.male.length} Cats</span>
                    )}
                    {t.categories?.female && t.categories.female.length > 0 && (
                        <span className="px-2 py-1 rounded bg-pink-50 text-pink-700 text-[10px] font-bold">F: {t.categories.female.length} Cats</span>
                    )}
                 </div>

                 {userRole === 'ADMIN' && (
                     <div className="absolute top-4 right-12 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                         {status === 'LIVE' || status === 'COMPLETED' ? (
                            <div className="p-2 bg-slate-100 text-slate-400 rounded-lg cursor-not-allowed" title="Editing Locked">
                                <Lock size={16} />
                            </div>
                         ) : (
                            <>
                              <Button 
                                  variant="secondary"
                                  onClick={(e) => handleEditClick(e, t)}
                                  className="p-2 h-auto"
                                  title="Edit Tournament Details"
                              >
                                  <Edit3 size={16} />
                              </Button>
                              <Button 
                                  variant="danger"
                                  onClick={(e) => handleDeleteClick(e, t)}
                                  className="p-2 h-auto"
                                  title="Delete Tournament"
                              >
                                  <Trash2 size={16} />
                              </Button>
                            </>
                         )}
                     </div>
                 )}

                 <div className="pt-4 border-t border-slate-100 relative z-10">
                    <div className="flex justify-between items-center text-xs mb-2">
                        <span className="font-semibold text-slate-600">
                            {userRole === 'PLAYER' ? 'Your Picks' : 'Completion'}
                        </span>
                        <span className="font-bold text-slate-900">
                            {t.completion || 0}%
                        </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-primary rounded-full transition-all duration-1000 ease-out" 
                            style={{ width: '0%', animation: `growWidth 1s ease-out forwards ${index * 150 + 300}ms` }}
                        >
                             <style>{`@keyframes growWidth { to { width: ${t.completion || 0}% } }`}</style>
                        </div>
                    </div>
                 </div>
             </div>
             );
         })}

         {userRole === 'ADMIN' && (
             <button 
                onClick={handleCreateClick}
                style={{ animationDelay: `${tournaments.length * 100}ms` }}
                className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:border-primary hover:bg-blue-50/30 transition-all group min-h-[260px] opacity-0 animate-fade-in-up"
             >
                 <div className="size-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 mb-4 group-hover:scale-110 group-hover:bg-white group-hover:text-primary transition-all shadow-sm">
                     <Plus size={24} />
                 </div>
                 <h3 className="text-lg font-bold text-slate-900 mb-1">Add New Event</h3>
                 <p className="text-sm text-slate-500">Configure bracket and details</p>
             </button>
         )}
      </div>
    </div>
  );
};

export default TournamentList;
