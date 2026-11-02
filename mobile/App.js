import "react-native-gesture-handler";
import { enableScreens } from "react-native-screens";
enableScreens();

import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import IsAvansScreen from "./src/screens/IsAvansScreen";
import IsAvansListeScreen from "./src/screens/IsAvansListeScreen"; // 02.11.2026: İş Avanslarım tam liste + reddedilenler + detay
import MasrafFormScreen from "./src/screens/MasrafFormScreen";
import MalzemeScreen from "./src/screens/MalzemeScreen";
import UzerimdekiMalzemelerScreen from "./src/screens/UzerimdekiMalzemelerScreen";
import RolloutCleanupScreen from "./src/screens/RolloutCleanupScreen";
import RolloutIslerScreen from "./src/screens/RolloutIslerScreen";
import { HwMalzemeScreen, DepodakiSahalarScreen, HaftalikPlanScreen, EkiplerNeredeScreen } from "./src/screens/OperasyonScreens"; // 31.10.2026: operasyon ekranları
import EkranHata from "./src/EkranHata";

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem("user");
        const token = await AsyncStorage.getItem("token");
        if (saved && token) {
          setUser(JSON.parse(saved));
        }
      } catch (_) {}
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#EFF6FF" }}>
          <ActivityIndicator size="large" color="#1D4ED8" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!user) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <LoginScreen onLoginSuccess={(u) => setUser(u)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home">
            {(props) => (
              <EkranHata ekran="Home" navigation={props.navigation}>
                <HomeScreen
                  {...props}
                  user={user}
                  onLogout={() => setUser(null)}
                />
              </EkranHata>
            )}
          </Stack.Screen>
          <Stack.Screen name="IsAvans">
            {(props) => <EkranHata ekran="IsAvans" navigation={props.navigation}><IsAvansScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="IsAvansListe">
            {(props) => <EkranHata ekran="IsAvansListe" navigation={props.navigation}><IsAvansListeScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="MasrafForm">
            {(props) => <EkranHata ekran="MasrafForm" navigation={props.navigation}><MasrafFormScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="Malzeme">
            {(props) => <EkranHata ekran="Malzeme" navigation={props.navigation}><MalzemeScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="UzerimdekiMalzemeler">
            {(props) => <EkranHata ekran="UzerimdekiMalzemeler" navigation={props.navigation}><UzerimdekiMalzemelerScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="RolloutCleanup">
            {(props) => <EkranHata ekran="RolloutCleanup" navigation={props.navigation}><RolloutCleanupScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="RolloutIsler">
            {(props) => <EkranHata ekran="RolloutIsler" navigation={props.navigation}><RolloutIslerScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          {/* 31.10.2026: operasyon ekranları — yetki ve firma kapsamı sunucuda; web ile aynı uçlar */}
          <Stack.Screen name="HwMalzeme">
            {(props) => <EkranHata ekran="HwMalzeme" navigation={props.navigation}><HwMalzemeScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="DepodakiSahalar">
            {(props) => <EkranHata ekran="DepodakiSahalar" navigation={props.navigation}><DepodakiSahalarScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="HaftalikPlan">
            {(props) => <EkranHata ekran="HaftalikPlan" navigation={props.navigation}><HaftalikPlanScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
          <Stack.Screen name="EkiplerNerede">
            {(props) => <EkranHata ekran="EkiplerNerede" navigation={props.navigation}><EkiplerNeredeScreen {...props} user={user} /></EkranHata>}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
