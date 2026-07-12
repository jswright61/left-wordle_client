(function() {
    "use strict";

    function $(id) {
        return document.getElementById(id);
    }

    function setStatus(element, message, isError) {
        if (!element) return;
        element.textContent = message || "";
        element.style.color = isError ? "#d64242" : "";
    }

    function errorMessage(error) {
        if (error && error.detail) return error.detail;
        if (error && error.message) return error.message;
        return "Something went wrong. Please try again.";
    }

    class LoginUI {
        openOverlay() {
            var overlay = $("login");
            if (!overlay) return;
            overlay.classList.remove("hidden");
            this.render();
        }

        closeOverlay() {
            var overlay = $("login");
            if (overlay) overlay.classList.add("hidden");
        }

        render() {
            var loggedOutSection = $("login-logged-out-section");
            var loggedInSection = $("login-logged-in-section");
            if (!loggedOutSection || !loggedInSection) return;

            if (window.LeftWordleAuth.isLoggedIn()) {
                loggedOutSection.classList.add("hidden");
                loggedInSection.classList.remove("hidden");
                var emailLine = $("login-account-email");
                if (emailLine) {
                    emailLine.textContent = window.LeftWordleAuth.email
                        ? "Account email: " + window.LeftWordleAuth.email
                        : "No email on file";
                }
            } else {
                loggedOutSection.classList.remove("hidden");
                loggedInSection.classList.add("hidden");
            }

            var headerButton = $("login-button");
            if (headerButton) {
                headerButton.classList.toggle("hidden", !window.LEFT_WORDLE_CONFIG || !window.LEFT_WORDLE_CONFIG.passkeyAuthEnabled);
            }
        }

        async handleRegister() {
            var statusEl = $("login-status");
            var emailInput = $("login-email-input");
            var email = emailInput ? emailInput.value.trim() : "";
            setStatus(statusEl, "Creating passkey...", false);
            try {
                var result = await window.LeftWordleAuth.register({ email: email || undefined });
                this.render();
                setStatus(statusEl, "Passkey created.", false);
                if (!result.joined_existing_account && hasAnyLocalData()) {
                    this.openImportModal();
                } else if (result.joined_existing_account) {
                    await this.syncAndAnnounce();
                }
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async handleSignIn() {
            var statusEl = $("login-status");
            setStatus(statusEl, "Signing in...", false);
            try {
                await window.LeftWordleAuth.login();
                this.render();
                await this.syncAndAnnounce();
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async syncAndAnnounce() {
            var app = document.querySelector("game-app");
            try {
                await window.LeftWordleAuth.syncFromServerAndOverwriteLocal();
                if (app && typeof app.addToast === "function") {
                    app.addToast("Logged in — your synced history and stats are now loaded", 3000, true);
                }
            } catch (error) {
                if (app && typeof app.addToast === "function") {
                    app.addToast("Logged in, but syncing your data failed — try reopening the app", 3000, true);
                }
            }
        }

        openImportModal() {
            var modal = $("login-import-modal");
            if (modal) modal.classList.remove("hidden");
        }

        closeImportModal() {
            var modal = $("login-import-modal");
            if (modal) modal.classList.add("hidden");
        }

        async handleImportAccept() {
            this.closeImportModal();
            var statusEl = $("login-status");
            setStatus(statusEl, "Importing your local history...", false);
            try {
                var result = await window.LeftWordleAuth.importLocalData();
                setStatus(statusEl, "Imported " + result.imported_games + " game(s) to your account.", false);
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async handleLogout() {
            var statusEl = $("login-account-status");
            try {
                await window.LeftWordleAuth.logout();
                this.render();
                setStatus(statusEl, "Logged out.", false);
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async handleAddDeviceLink(delivery) {
            var statusEl = $("login-account-status");
            setStatus(statusEl, delivery === "email" ? "Sending email..." : "Generating link...", false);
            try {
                var result = await window.LeftWordleApi.client.deviceLink(delivery);
                if (delivery === "qr") {
                    this.openDeviceLinkModal(result.url);
                } else {
                    setStatus(statusEl, "Emailed a one-time link to add a device.", false);
                }
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        openDeviceLinkModal(url) {
            var modal = $("login-device-link-modal");
            var urlInput = $("login-device-link-url");
            if (urlInput) urlInput.value = url;
            if (modal) modal.classList.remove("hidden");
        }

        closeDeviceLinkModal() {
            var modal = $("login-device-link-modal");
            if (modal) modal.classList.add("hidden");
        }

        openSetEmailModal() {
            var modal = $("login-set-email-modal");
            var input = $("login-set-email-input");
            if (input) input.value = window.LeftWordleAuth.email || "";
            if (modal) modal.classList.remove("hidden");
        }

        closeSetEmailModal() {
            var modal = $("login-set-email-modal");
            if (modal) modal.classList.add("hidden");
        }

        async handleSetEmailSave() {
            var input = $("login-set-email-input");
            var statusEl = $("login-account-status");
            var email = input ? input.value.trim() : "";
            if (!email) return;
            try {
                var result = await window.LeftWordleApi.client.patchEmail(email);
                window.LeftWordleAuth.email = result.email;
                this.closeSetEmailModal();
                this.render();
                setStatus(statusEl, "Email saved.", false);
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        // Auto-prompt shown once per app load for a logged-out device,
        // unless the user has asked not to be asked. Reuses the same
        // overlay the header button opens.
        async maybePromptLogin() {
            var config = window.LEFT_WORDLE_CONFIG || {};
            if (!config.passkeyAuthEnabled) return;
            if (!window.LeftWordleWebauthn || !window.LeftWordleWebauthn.isSupported()) return;
            await window.LeftWordleAuth.ready;
            if (window.LeftWordleAuth.isLoggedIn()) return;
            if (StorageController.preferences.get("suppressLoginPrompt")) return;
            this.openOverlay();
        }

        async maybeHandleDeviceLinkLanding() {
            var params = new URLSearchParams(window.location.search);
            var linkToken = params.get("link_token");
            if (!linkToken) return;

            var landing = $("login-link-landing");
            var button = $("login-link-landing-button");
            var statusEl = $("login-link-landing-status");
            if (!landing || !button) return;

            landing.classList.remove("hidden");
            var headerContainer = $("header-container");
            if (headerContainer) headerContainer.style.display = "none";

            button.addEventListener("click", async function() {
                setStatus(statusEl, "Completing passkey setup...", false);
                try {
                    await window.LeftWordleAuth.registerViaDeviceLink(linkToken);
                    await window.leftWordleLoginUI.syncAndAnnounce();
                    setStatus(statusEl, "Device added. Reloading...", false);
                    var url = new URL(window.location.href);
                    url.searchParams.delete("link_token");
                    window.location.href = url.toString();
                } catch (error) {
                    setStatus(statusEl, errorMessage(error), true);
                }
            });
        }

        init() {
            var self = this;

            var headerButton = $("login-button");
            if (headerButton) {
                headerButton.addEventListener("click", function() { self.openOverlay(); });
            }
            var closeIcon = $("login-close");
            if (closeIcon) {
                closeIcon.addEventListener("click", function() { self.closeOverlay(); });
            }

            var registerButton = $("login-register-button");
            if (registerButton) registerButton.addEventListener("click", function() { self.handleRegister(); });

            var signInButton = $("login-signin-button");
            if (signInButton) signInButton.addEventListener("click", function() { self.handleSignIn(); });

            var suppressLink = $("login-suppress-link");
            if (suppressLink) {
                suppressLink.addEventListener("click", function() {
                    StorageController.preferences.set("suppressLoginPrompt", true);
                    self.closeOverlay();
                });
            }

            var importAccept = $("login-import-accept");
            if (importAccept) importAccept.addEventListener("click", function() { self.handleImportAccept(); });
            var importDecline = $("login-import-decline");
            if (importDecline) importDecline.addEventListener("click", function() { self.closeImportModal(); });

            var logoutButton = $("login-logout-button");
            if (logoutButton) logoutButton.addEventListener("click", function() { self.handleLogout(); });

            var addDeviceLinkButton = $("login-add-device-link-button");
            if (addDeviceLinkButton) addDeviceLinkButton.addEventListener("click", function() { self.handleAddDeviceLink("qr"); });
            var addDeviceEmailButton = $("login-add-device-email-button");
            if (addDeviceEmailButton) addDeviceEmailButton.addEventListener("click", function() { self.handleAddDeviceLink("email"); });

            var deviceLinkCopy = $("login-device-link-copy");
            if (deviceLinkCopy) {
                deviceLinkCopy.addEventListener("click", function() {
                    var urlInput = $("login-device-link-url");
                    if (!urlInput) return;
                    urlInput.select();
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(urlInput.value).catch(function() {});
                    } else {
                        document.execCommand("copy");
                    }
                    setStatus($("login-device-link-status"), "Copied.", false);
                });
            }
            var deviceLinkClose = $("login-device-link-close");
            if (deviceLinkClose) deviceLinkClose.addEventListener("click", function() { self.closeDeviceLinkModal(); });

            var setEmailButton = $("login-set-email-button");
            if (setEmailButton) setEmailButton.addEventListener("click", function() { self.openSetEmailModal(); });
            var setEmailSave = $("login-set-email-save");
            if (setEmailSave) setEmailSave.addEventListener("click", function() { self.handleSetEmailSave(); });
            var setEmailCancel = $("login-set-email-cancel");
            if (setEmailCancel) setEmailCancel.addEventListener("click", function() { self.closeSetEmailModal(); });

            this.maybeHandleDeviceLinkLanding();

            var config = window.LEFT_WORDLE_CONFIG || {};
            if (config.passkeyAuthEnabled && window.LeftWordleAuth) {
                window.LeftWordleAuth.ready.then(function() { self.render(); });
            } else {
                this.render();
            }
        }
    }

    function hasAnyLocalData() {
        return !!(Object.keys(StorageController.history.getAll()).length ||
            Object.keys(StorageController.gameState.getAll()).length ||
            Object.keys(StorageController.statistics.getAll()).length);
    }

    var loginUI = new LoginUI();
    window.leftWordleLoginUI = loginUI;
    window.LeftWordleLoginUI = loginUI;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { loginUI.init(); });
    } else {
        loginUI.init();
    }
})();
