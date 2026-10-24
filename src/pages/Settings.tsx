
import React from "react";
import MainLayout from "@/components/Layout/MainLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, ThemePreference } from "@/contexts/ThemeContext";
import ChangePasswordForm from "@/components/Account/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon, User } from "lucide-react";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Settings: React.FC = () => {
  const { settings, updateSettings } = useAppSettings();
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground">
              Manage your application preferences
            </p>
          </div>
        </div>

        <Tabs defaultValue="general" className="space-y-4">
          <TabsList>
            <TabsTrigger value="general">
              <SettingsIcon className="h-4 w-4 mr-2" />
              General
            </TabsTrigger>
            <TabsTrigger value="account">
              <User className="h-4 w-4 mr-2" />
              Account
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="general" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Light or dark mode (default: follow the system setting)</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={preference} onValueChange={(v: ThemePreference) => setPreference(v)}>
                  <SelectTrigger id="theme-preference" className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bookmark Icons</CardTitle>
                <CardDescription>
                  Configure how bookmark icons are displayed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="favicon-fetch">Auto-fetch Favicon</Label>
                    <Switch
                      id="favicon-fetch"
                      checked={settings.faviconFetchEnabled}
                      onCheckedChange={(checked) =>
                        updateSettings({ faviconFetchEnabled: checked })
                      }
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Show website icons. They are fetched and cached by the BookmarkHub server, your browser does not contact the sites.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fallback-preference">Icon Fallback Style</Label>
                  <Select
                    value={settings.iconFallbackPreference}
                    onValueChange={(value: 'emoji' | 'text') =>
                      updateSettings({ iconFallbackPreference: value })
                    }
                  >
                    <SelectTrigger id="fallback-preference">
                      <SelectValue placeholder="Select fallback style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emoji">Emoji Icons</SelectItem>
                      <SelectItem value="text">Text Initials</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Choose how icons should appear when favicon cannot be loaded
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* The former "Guest access" switch was removed: it was only stored in the browser and had no effect. */}
          </TabsContent>
          
          <TabsContent value="account" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Account Information</CardTitle>
                <CardDescription>
                  Your personal account details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-sm">Username</Label>
                  <p className="font-medium">{user?.username}</p>
                </div>
                
                <div className="space-y-1">
                  <Label className="text-sm">Role</Label>
                  <p className="font-medium">{user?.isAdmin ? "Administrator" : "User"}</p>
                </div>
                
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Change password</CardTitle>
                <CardDescription>All other sessions of your account will be signed out.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChangePasswordForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Export</CardTitle>
                <CardDescription>Download your bookmarks (and the shared ones) as a JSON file.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" asChild>
                  <a href="/api/export" download>Download export</a>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
};

export default Settings;
