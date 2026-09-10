package httpserver

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	adminapi "app/internal/api/http/admin"
	clientapi "app/internal/api/http/client"
	"app/internal/appconnection"
	"app/internal/application/account"
	"app/internal/application/accountdeactivation"
	"app/internal/application/adminauth"
	appapp "app/internal/application/app"
	contactapp "app/internal/application/contact"
	conversationapp "app/internal/application/conversation"
	"app/internal/application/dashboard"
	"app/internal/application/directmessagepolicy"
	documentapp "app/internal/application/document"
	"app/internal/application/emailauth"
	entitycardapp "app/internal/application/entitycard"
	externalauthapp "app/internal/application/externalauth"
	fileapp "app/internal/application/file"
	"app/internal/application/identityprovider"
	messageapp "app/internal/application/message"
	messagecontentapp "app/internal/application/messagecontent"
	mobilepushapp "app/internal/application/mobilepush"
	projectapp "app/internal/application/project"
	reportapp "app/internal/application/report"
	searchapp "app/internal/application/search"
	settingsapp "app/internal/application/settings"
	taskapp "app/internal/application/task"
	userblockapp "app/internal/application/userblock"
	"app/internal/application/usermanagement"
	"app/internal/config"
	externalauthinfra "app/internal/infrastructure/externalauth"
	"app/internal/infrastructure/filestorage"
	mailinfra "app/internal/infrastructure/mail"
	searchinfra "app/internal/infrastructure/search"
	"app/internal/realtime"
	"app/internal/store"

	"github.com/labstack/echo/v4"
	echoSwagger "github.com/swaggo/echo-swagger"
	"gorm.io/gorm"
)

type Server struct {
	db                  *gorm.DB
	cfg                 config.Config
	accounts            *account.Service
	clientAccounts      *clientapi.AccountAPI
	clientEmailAuth     *clientapi.EmailAuthAPI
	adminAuth           *adminauth.Service
	adminAuthAPI        *adminapi.AuthAPI
	userManagement      *usermanagement.Service
	adminUsers          *adminapi.UserAPI
	dashboard           *dashboard.Service
	adminDashboard      *adminapi.DashboardAPI
	identityProviders   *identityprovider.Service
	adminProviders      *adminapi.IdentityProviderAPI
	externalAuth        *externalauthapp.Service
	clientExternalAuth  *clientapi.ExternalAuthAPI
	apps                *appapp.Service
	adminApps           *adminapi.AppAPI
	clientApps          *clientapi.AppAPI
	files               *fileapp.Service
	clientFiles         *clientapi.FileAPI
	contacts            *contactapp.Service
	clientContacts      *clientapi.ContactAPI
	conversations       *conversationapp.Service
	clientConversations *clientapi.ConversationAPI
	messages            *messageapp.Service
	messageContents     *messagecontentapp.Service
	clientMessages      *clientapi.MessageAPI
	mobilePush          *mobilepushapp.Service
	clientPush          *clientapi.PushAPI
	searches            *searchapp.Service
	clientSearch        *clientapi.SearchAPI
	reports             *reportapp.Service
	clientReports       *clientapi.ReportAPI
	adminReports        *adminapi.ReportAPI
	userBlocks          *userblockapp.Service
	clientUserBlocks    *clientapi.UserBlockAPI
	settings            *settingsapp.Service
	clientInfo          *clientapi.InfoAPI
	adminSettings       *adminapi.SettingsAPI
	adminPasswordLogin  *adminapi.PasswordLoginSettingsAPI
	adminEmailLogin     *adminapi.EmailLoginSettingsAPI
	projects            *projectapp.Service
	clientProjects      *clientapi.ProjectAPI
	documents           *documentapp.Service
	clientDocuments     *clientapi.DocumentAPI
	entityCards         entitycardapp.Resolver
	tasks               *taskapp.Service
	clientTasks         *clientapi.TaskAPI
	appConnections      *appconnection.Manager
	realtime            *realtime.ConnectionPool
	appEventMu          sync.Mutex
	asrRealtimeURL      string

	beforeAppEventLock     func(store.Message)
	afterUserMessageCommit func(store.Message)
}

func NewRouter(db *gorm.DB, cfg config.Config) *echo.Echo {
	return NewRouterWithRealtimeOptions(db, cfg, realtime.Options{})
}

func NewRouterWithRealtimeOptions(db *gorm.DB, cfg config.Config, realtimeOptions realtime.Options) *echo.Echo {
	router, _ := newRouter(db, cfg, realtimeOptions, nil)
	return router
}

// The returned function must be called after HTTP shutdown and cancellation of
// ctx, so buffered activity is persisted before the process exits.
func NewRouterWithTaskReminderWorker(ctx context.Context, db *gorm.DB, cfg config.Config) (*echo.Echo, func(context.Context) error) {
	router, accounts := newRouter(db, cfg, realtime.Options{}, ctx)
	activityDone := make(chan struct{})
	go func() {
		defer close(activityDone)
		accounts.RunActivityWorker(ctx)
	}()
	return router, func(shutdownCtx context.Context) error {
		select {
		case <-activityDone:
			return accounts.CloseActivity(shutdownCtx)
		case <-shutdownCtx.Done():
			return shutdownCtx.Err()
		}
	}
}

func newRouter(db *gorm.DB, cfg config.Config, realtimeOptions realtime.Options, workerContext context.Context) (*echo.Echo, *account.Service) {
	if err := store.InstallUserNicknamePolicy(db); err != nil {
		panic(err)
	}
	server := &Server{
		db:             db,
		cfg:            cfg,
		asrRealtimeURL: defaultASRModelRealtimeURL,
	}
	realtimeOptions.RecordUserPong = server.recordUserPong
	server.realtime = realtime.NewConnectionPool(realtimeOptions)
	server.files = fileapp.NewService(fileapp.Dependencies{
		DB:                       db,
		Storage:                  filestorage.New(cfg.Storage),
		TemporaryExpireDays:      cfg.Storage.Lifecycle.TemporaryExpireDays,
		LargeTemporaryExpireDays: cfg.Storage.Lifecycle.LargeTemporaryExpireDays,
	})
	server.clientFiles = clientapi.NewFileAPI(server.files)
	server.adminAuth = adminauth.NewService(adminauth.Dependencies{DB: db, Password: cfg.Admin.Password})
	server.adminAuthAPI = adminapi.NewAuthAPI(server.adminAuth, server.adminAuth)
	server.appConnections = appconnection.NewManager(appconnection.Options{
		RequestHandler: server.handleAppRequest,
	})
	server.apps = appapp.NewService(appapp.Dependencies{
		DB: db, Apps: cfg.Apps, Files: server.files, Connections: server.appConnections,
	})
	server.adminApps = adminapi.NewAppAPI(server.apps)
	server.clientApps = clientapi.NewAppAPI(server.apps)
	server.settings = settingsapp.NewService(settingsapp.Dependencies{DB: db, Notifications: server})
	server.adminSettings = adminapi.NewSettingsAPI(server.settings)
	server.adminPasswordLogin = adminapi.NewPasswordLoginSettingsAPI(server.settings)
	server.accounts = account.NewService(account.Dependencies{
		DB:                   db,
		Files:                server.files,
		PasswordLoginPolicy:  server.settings,
		UserNicknamePolicy:   server.settings,
		ProfileNotifications: server,
	})
	server.clientAccounts = clientapi.NewAccountAPI(
		server.accounts,
		server.accounts,
		func(c echo.Context, session account.AuthenticatedSession) {
			c.Set(currentUserContextKey, legacyUserFromAccount(session.Account))
		},
	)
	deactivation := accountdeactivation.NewService(accountdeactivation.Dependencies{
		DB: db, Settings: server.settings, Mailer: mailinfra.NewSMTPMailer(),
		Secret: cfg.Apps.AIAssistantSecret, Presence: server.realtime,
		InvalidateProfile: server.accounts.InvalidateProfile,
	})
	clientDeactivation := clientapi.NewAccountDeactivationAPI(deactivation)
	emailAuth := emailauth.NewService(emailauth.Dependencies{
		Accounts: server.accounts, Settings: server.settings, Mailer: mailinfra.NewSMTPMailer(),
		ClientOrigin: cfg.Server.ClientOrigin(),
	})
	server.clientEmailAuth = clientapi.NewEmailAuthAPI(emailAuth)
	server.adminEmailLogin = adminapi.NewEmailLoginSettingsAPI(server.settings, emailAuth)
	server.clientInfo = clientapi.NewInfoAPI(server.settings, server.accounts)
	server.projects = projectapp.NewService(projectapp.Dependencies{
		DB:             db,
		Files:          server.files,
		NicknamePolicy: server.settings,
	})
	server.clientProjects = clientapi.NewProjectAPI(server.projects)
	server.documents = documentapp.NewService(documentapp.Dependencies{DB: db})
	server.clientDocuments = clientapi.NewDocumentAPI(server.documents)
	server.entityCards = entitycardapp.NewService(entitycardapp.Dependencies{
		DB: db, Projects: server.projects,
	})
	directMessaging := directmessagepolicy.New(server.settings)
	server.conversations = conversationapp.NewService(conversationapp.Dependencies{
		AppEvents:       server,
		AppEventLocker:  &server.appEventMu,
		DB:              db,
		Apps:            cfg.Apps,
		Files:           server.files,
		Projects:        server.projects,
		Notifications:   server,
		DirectMessaging: directMessaging,
		NicknamePolicy:  server.settings,
	})
	server.clientConversations = clientapi.NewConversationAPI(server.conversations, server.projects)
	server.reports = reportapp.NewService(reportapp.Dependencies{DB: db})
	server.clientReports = clientapi.NewReportAPI(server.reports)
	server.adminReports = adminapi.NewReportAPI(server.reports)
	server.userBlocks = userblockapp.NewService(userblockapp.Dependencies{DB: db})
	server.clientUserBlocks = clientapi.NewUserBlockAPI(server.userBlocks)
	server.tasks = taskapp.NewService(taskapp.Dependencies{
		DB:            db,
		Notifications: server,
	})
	server.clientTasks = clientapi.NewTaskAPI(server.tasks)
	server.dashboard = dashboard.NewService(dashboard.Dependencies{
		DB: db, Presence: server.realtime,
	})
	server.adminDashboard = adminapi.NewDashboardAPI(server.dashboard)
	server.userManagement = usermanagement.NewService(usermanagement.Dependencies{
		DB: db, Presence: server.realtime, AppConnections: server.appConnections, ProfileNotifications: server, NicknamePolicy: server.settings,
	})
	server.adminUsers = adminapi.NewUserAPI(server.userManagement)
	server.identityProviders = identityprovider.NewService(identityprovider.Dependencies{DB: db})
	server.adminProviders = adminapi.NewIdentityProviderAPI(server.identityProviders, cfg.Server.ClientOrigin())
	server.externalAuth = externalauthapp.NewService(externalauthapp.Dependencies{
		DB: db, Providers: server.identityProviders, OAuth: externalauthinfra.NewOAuth(),
		InvalidateProfile: server.accounts.InvalidateProfile,
	})
	server.clientExternalAuth = clientapi.NewExternalAuthAPI(server.externalAuth, cfg.Server.ClientOrigin())
	server.contacts = contactapp.NewService(contactapp.Dependencies{
		DB: db, Apps: cfg.Apps, UserPresence: server.realtime, AppPresence: server.appConnections,
		Settings: server.settings, NicknamePolicy: server.settings, Notifications: server, FriendshipMessages: server,
	})
	server.clientContacts = clientapi.NewContactAPI(server.contacts)
	server.messageContents = messagecontentapp.NewService(messagecontentapp.Dependencies{
		EntityCards: server.entityCards,
		FetchLinkTitle: func(ctx context.Context, linkURL string) (string, error) {
			return fetchLinkPreviewTitle(ctx, linkURL)
		},
	})
	server.messages = messageapp.NewService(messageapp.Dependencies{
		DB: db, Bodies: server.messageContents,
		ForwardBodies: server.messageContents, Files: server.files,
		TaskNotificationBodies: server.messageContents, Apps: cfg.Apps,
		TaskReminderBodies: server.messageContents,
		Notifications:      server, ReactionNotifications: server,
		AppEvents: server, AppEventLocker: &server.appEventMu,
		BeforeAppEventLock: func(message messageapp.Message) {
			if server.beforeAppEventLock != nil {
				server.beforeAppEventLock(legacyStoredMessage(message))
			}
		},
		AfterUserMessageCommit: func(message messageapp.Message) {
			if server.afterUserMessageCommit != nil {
				server.afterUserMessageCommit(legacyStoredMessage(message))
			}
		},
		DirectMessaging: directMessaging,
	})
	server.clientMessages = clientapi.NewMessageAPI(server.messages, server.files)
	var pushCipher *mobilepushapp.TokenCipher
	var pushGateway mobilepushapp.GatewayClient
	if cfg.Push.Enabled {
		pushKeys := append([][]byte{cfg.Push.CredentialEncryptionKey}, cfg.Push.PreviousEncryptionKeys...)
		var err error
		pushCipher, err = mobilepushapp.NewTokenCipher(pushKeys...)
		if err != nil {
			panic(err)
		}
		pushGateway = mobilepushapp.NewGatewayClient(cfg.Push.ServerKey)
	}
	var mobilePushErr error
	server.mobilePush, mobilePushErr = mobilepushapp.NewService(mobilepushapp.Dependencies{
		DB: db, Cipher: pushCipher, Gateway: pushGateway, Enabled: cfg.Push.Enabled,
	})
	if mobilePushErr != nil {
		panic(mobilePushErr)
	}
	server.clientPush = clientapi.NewPushAPI(server.mobilePush)
	server.searches = searchapp.NewService(searchapp.Dependencies{
		Backend:       searchinfra.NewPostgresMessageBackend(db),
		Conversations: server.conversations,
		Messages:      server.messages,
	})
	server.clientSearch = clientapi.NewSearchAPI(server.searches)

	router := echo.New()
	router.HideBanner = true
	router.HidePort = true

	router.GET("/healthz", func(c echo.Context) error {
		return success(c, http.StatusOK, map[string]any{"status": "ok"})
	})
	router.GET("/metrics", server.mobilePushMetrics)
	if docsDir, ok := findAPIDocsDir(); ok {
		router.Static("/api-docs", docsDir)
		router.GET("/swagger/*", echoSwagger.EchoWrapHandler(echoSwagger.URL("/api-docs/swagger.json")))
	}
	server.adminAuthAPI.RegisterPublicRoutes(router)
	server.clientAccounts.RegisterPublicRoutes(router)
	server.clientEmailAuth.RegisterPublicRoutes(router)
	server.clientExternalAuth.RegisterPublicRoutes(router)
	server.clientInfo.RegisterPublicRoutes(router)
	router.GET("/api/app/ws", server.appWebSocket)

	client := router.Group("/api/client", server.clientAccounts.RequireSession)
	server.clientAccounts.RegisterProtectedRoutes(client)
	clientDeactivation.RegisterRoutes(client)
	server.clientApps.RegisterRoutes(client)
	server.clientFiles.RegisterRoutes(client)
	server.clientProjects.RegisterRoutes(client)
	server.clientDocuments.RegisterRoutes(client)
	server.clientTasks.RegisterRoutes(client)
	server.clientConversations.RegisterRoutes(client)
	server.clientReports.RegisterRoutes(client)
	server.clientUserBlocks.RegisterRoutes(client)
	server.clientContacts.RegisterRoutes(client)
	server.clientMessages.RegisterRoutes(client)
	server.clientPush.RegisterRoutes(client)
	server.clientSearch.RegisterRoutes(client)
	client.GET("/ws", server.clientWebSocket)
	client.GET("/asr/realtime", server.clientASRWebSocket)

	admin := router.Group("/api/admin", server.adminAuthAPI.RequireSession)
	server.adminSettings.RegisterRoutes(admin)
	server.adminPasswordLogin.RegisterRoutes(admin)
	server.adminEmailLogin.RegisterRoutes(admin)
	server.adminDashboard.RegisterRoutes(admin)
	server.adminApps.RegisterRoutes(admin)
	server.adminUsers.RegisterRoutes(admin)
	server.adminReports.RegisterRoutes(admin)
	server.adminProviders.RegisterRoutes(admin)
	if workerContext != nil {
		go server.tasks.RunReminderWorker(workerContext)
		go server.mobilePush.RunWorker(workerContext)
	}
	return router, server.accounts
}

func legacyUserFromAccount(value account.Account) store.User {
	var phone *string
	if value.Phone != "" {
		phoneValue := value.Phone
		phone = &phoneValue
	}
	return store.User{
		ID:           value.ID,
		Email:        value.Email,
		Name:         value.Name,
		Nickname:     value.Nickname,
		Phone:        phone,
		Avatar:       value.Avatar,
		Status:       value.Status,
		LastOnlineAt: value.LastOnlineAt,
		CreatedAt:    value.CreatedAt,
		UpdatedAt:    value.UpdatedAt,
	}
}

func (s *Server) messageContentService() *messagecontentapp.Service {
	if s.messageContents != nil {
		return s.messageContents
	}
	return messagecontentapp.NewService(messagecontentapp.Dependencies{
		EntityCards: s.entityCards,
		FetchLinkTitle: func(ctx context.Context, linkURL string) (string, error) {
			return fetchLinkPreviewTitle(ctx, linkURL)
		},
	})
}

func findAPIDocsDir() (string, bool) {
	return findDirContaining("api-docs", "swagger.json")
}

func findDirContaining(relativeDir string, requiredFile string) (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}

	for {
		candidate := filepath.Join(dir, relativeDir)
		statPath := candidate
		if requiredFile != "" {
			statPath = filepath.Join(candidate, requiredFile)
		}
		if _, err := os.Stat(statPath); err == nil {
			return candidate, true
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
