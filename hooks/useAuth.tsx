import { useState, useEffect, createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { UserRole } from '@/types/user';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: any | null;
  userRole: UserRole;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Load user profile and role
          setTimeout(async () => {
            await loadUserProfile(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setUserRole('user');
          setIsAdmin(false);
        }
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session) {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Set up real-time subscription for profile changes
  useEffect(() => {
    if (!user?.id) return;

    console.log('Setting up profile subscription for user:', user.id);

    const profileSubscription = supabase
      .channel('profile_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Profile updated in real-time:', payload);

          if (payload.eventType === 'UPDATE' && payload.new) {
            const updatedProfile = payload.new;
            setProfile(updatedProfile);
            const role = updatedProfile?.role as UserRole || 'user';
            setUserRole(role);
            setIsAdmin(['tribe_leader', 'admin', 'site_admin'].includes(role));

            console.log('Profile state updated:', {
              role,
              isAdmin: ['tribe_leader', 'admin', 'site_admin'].includes(role)
            });
          }
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up profile subscription');
      supabase.removeChannel(profileSubscription);
    };
  }, [user?.id]);

  const loadUserProfile = async (userId: string, retryCount = 0) => {
    try {
      console.log(`Loading profile for user: ${userId} (attempt ${retryCount + 1})`);

      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error loading profile:', {
          message: error?.message || 'Unknown error',
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
          error: JSON.stringify(error, null, 2)
        });

        // If profile doesn't exist, create it
        if (error.code === 'PGRST116' && retryCount === 0) {
          console.log('Profile not found, creating new one...');
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user) {
            const { error: createError } = await supabase
              .from('profiles')
              .insert({
                user_id: userData.user.id,
                email: userData.user.email,
                display_name: userData.user.user_metadata?.display_name || userData.user.email,
                role: 'user'
              });

            if (!createError) {
              // Retry loading the profile
              return await loadUserProfile(userId, retryCount + 1);
            }
          }
        }
        return;
      }

      console.log('Profile loaded successfully:', profileData);
      setProfile(profileData);
      const role = profileData?.role as UserRole || 'user';
      setUserRole(role);
      setIsAdmin(['tribe_leader', 'admin', 'site_admin'].includes(profileData?.role || 'user'));
    } catch (error: any) {
      console.error('Error loading profile:', {
        message: error?.message || 'Unknown error',
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        error: JSON.stringify(error, null, 2)
      });
    }
  };

  const refreshProfile = async () => {
    if (user) {
      console.log('Refreshing profile for user:', user.id);
      await loadUserProfile(user.id);
      // Force a small delay to ensure UI updates
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          display_name: displayName || email,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    profile,
    userRole,
    isAdmin,
    loading,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
