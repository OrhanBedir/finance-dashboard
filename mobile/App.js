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
import MasrafFormScreen from "./src/screens/MasrafFormScreen";

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
              <HomeScreen
                {...props}
                user={user}
                onLogout={() => setUser(null)}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="IsAvans">
            {(props) => <IsAvansScreen {...props} user={user} />}
          </Stack.Screen>
          <Stack.Screen name="MasrafForm">
            {(props) => <MasrafFormScreen {...props} user={user} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
