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
                var deviceNameInput = $("login-device-name-input");
                if (deviceNameInput && !deviceNameInput.value && window.LeftWordleAuth.guessDeviceNickname) {
                    deviceNameInput.value = window.LeftWordleAuth.guessDeviceNickname();
                }
                var suppressLink = $("login-suppress-link");
                if (suppressLink) {
                    suppressLink.classList.toggle("hidden", !!StorageController.preferences.get("suppressLoginPrompt"));
                }
            }

            var headerButton = $("login-button");
            if (headerButton) {
                headerButton.classList.toggle("hidden", !window.LEFT_WORDLE_CONFIG || !window.LEFT_WORDLE_CONFIG.passkeyAuthEnabled);
                var isLoggedIn = window.LeftWordleAuth.isLoggedIn();
                headerButton.title = isLoggedIn ? "Account (logged in)" : "Account (logged out)";
                var headerIcon = headerButton.querySelector("game-icon");
                if (headerIcon) {
                    headerIcon.setAttribute("icon", isLoggedIn ? "account-active" : "account");
                }
            }

            if (window.leftWordleToolsMenu && typeof window.leftWordleToolsMenu.refreshImportRestoreAvailability === "function") {
                window.leftWordleToolsMenu.refreshImportRestoreAvailability();
            }
        }

        // Re-enable the prompt on successful login/register so a future logout
        // on this device (new browser profile, cleared passkey, etc.) surfaces
        // it again instead of leaving the user stranded on a signed-out device.
        resetSuppressedLoginPrompt() {
            StorageController.preferences.set("suppressLoginPrompt", false);
        }

        async handleRegister() {
            var statusEl = $("login-status");
            var emailInput = $("login-email-input");
            var email = emailInput ? emailInput.value.trim() : "";
            var deviceNameInput = $("login-device-name-input");
            var nickname = deviceNameInput ? deviceNameInput.value.trim() : "";
            setStatus(statusEl, "Creating passkey...", false);
            try {
                var result = await window.LeftWordleAuth.register({ email: email || undefined, nickname: nickname || undefined });
                this.render();
                setStatus(statusEl, "Passkey created.", false);
                if (result.joined_existing_account) {
                    await this.syncAndAnnounce();
                } else {
                    await this.pushLocalDataToNewAccount();
                }
                this.resetSuppressedLoginPrompt();
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async handleSignIn() {
            var statusEl = $("login-status");
            setStatus(statusEl, "Logging in...", false);
            try {
                await window.LeftWordleAuth.login();
                this.render();
                await this.syncAndAnnounce();
                this.resetSuppressedLoginPrompt();
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        // Pure authentication + display cache, not a data merge: online
        // play never writes account data into local storage (see
        // online_play_redesign.md), so this only populates
        // LeftWordleAuth.cachedProfile for the Stats screen etc. to read.
        async syncAndAnnounce() {
            var app = document.querySelector("game-app");
            try {
                await window.LeftWordleAuth.refreshCachedProfile();
                if (app && typeof app.addToast === "function") {
                    app.addToast("Logged in — your account data is now loaded", 3000, true);
                }
            } catch (error) {
                if (app && typeof app.addToast === "function") {
                    app.addToast("Logged in, but syncing your account data failed — try reopening the app", null, true, true);
                }
            }
        }

        // Counterpart to syncAndAnnounce for a brand-new account (as opposed
        // to joining an existing one via device link): there's no server
        // data to pull down yet, so this device's local data pushes up
        // instead. Order matches migration_rethink.md's Initial
        // Registration section -- the local storage snapshot is captured
        // "prior to anything else", before any of the other pushes can
        // alter local state.
        async pushLocalDataToNewAccount() {
            var app = document.querySelector("game-app");
            try {
                await window.LeftWordleAuth.syncNewUserSnapshot(window.StorageController.dumpRaw());

                await Promise.all([
                    window.LeftWordleAuth.syncPreferences(),
                    window.LeftWordleAuth.syncGameStateOnce(),
                    window.LeftWordleAuth.syncHistoryEntries(Object.values(window.StorageController.history.getAll() || {}))
                ]);

                var localStats = window.wordleStats.compute();
                var discrepancy = await window.LeftWordleAuth.statsDiscrepancyAfterPush(localStats && localStats.gamesPlayed);

                if (app && typeof app.addToast === "function") {
                    if (discrepancy) {
                        app.addToast(
                            "Account created. Your local history shows " + discrepancy.local +
                            " games played, but only " + discrepancy.server + " could be matched to specific " +
                            "puzzles — use Tools > Adjust Stats to correct the total if you'd like.",
                            6000, true
                        );
                    } else {
                        app.addToast("Account created — your local data has been saved", 3000, true);
                    }
                }
            } catch (error) {
                if (app && typeof app.addToast === "function") {
                    app.addToast("Account created, but saving your local data failed — try reopening the app", null, true, true);
                }
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

        openRecoverModal() {
            var modal = $("login-recover-modal");
            var input = $("login-recover-email-input");
            if (input) input.value = "";
            setStatus($("login-recover-status"), "", false);
            if (modal) modal.classList.remove("hidden");
        }

        closeRecoverModal() {
            var modal = $("login-recover-modal");
            if (modal) modal.classList.add("hidden");
        }

        async handleRequestRecovery() {
            var input = $("login-recover-email-input");
            var statusEl = $("login-recover-status");
            var email = input ? input.value.trim() : "";
            if (!email) return;
            setStatus(statusEl, "Sending...", false);
            try {
                await window.LeftWordleAuth.requestRecovery(email);
            } catch (error) {
                // Even on error, don't reveal whether the email matched an
                // account -- show the same generic message either way.
            }
            setStatus(statusEl, "If an account with that email exists, you'll receive an email with a link to recover it.", false);
        }

        async openPasskeysModal() {
            var modal = $("login-passkeys-modal");
            if (modal) modal.classList.remove("hidden");
            await this.renderPasskeysList();
        }

        closePasskeysModal() {
            var modal = $("login-passkeys-modal");
            if (modal) modal.classList.add("hidden");
        }

        async renderPasskeysList() {
            var self = this;
            var list = $("login-passkeys-list");
            var statusEl = $("login-passkeys-status");
            if (!list) return;
            setStatus(statusEl, "", false);
            list.innerHTML = "";
            try {
                var passkeys = await window.LeftWordleAuth.listPasskeys();
                passkeys.forEach(function(passkey) {
                    var row = document.createElement("div");
                    row.className = "setting";

                    var text = document.createElement("div");
                    text.className = "text";
                    var title = document.createElement("div");
                    title.className = "title";
                    title.textContent = passkey.nickname || "Unnamed device";
                    var subtitle = document.createElement("div");
                    subtitle.className = "description";
                    subtitle.textContent = "Added " + formatPasskeyDate(passkey.created_at) +
                        " · Last used " + (passkey.last_used_at ? formatPasskeyDate(passkey.last_used_at) : "Never");
                    text.appendChild(title);
                    text.appendChild(subtitle);

                    var control = document.createElement("div");
                    control.className = "control";
                    var disableButton = document.createElement("button");
                    disableButton.type = "button";
                    disableButton.textContent = "Disable";
                    disableButton.addEventListener("click", function() { self.handleRevokePasskey(passkey.id); });
                    control.appendChild(disableButton);

                    row.appendChild(text);
                    row.appendChild(control);
                    list.appendChild(row);
                });
            } catch (error) {
                setStatus(statusEl, errorMessage(error), true);
            }
        }

        async handleRevokePasskey(id) {
            var statusEl = $("login-passkeys-status");
            try {
                await window.LeftWordleAuth.revokePasskey(id);
                await this.renderPasskeysList();
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
            this.announceSessionExpiredIfNeeded();
            if (window.LeftWordleAuth.isLoggedIn()) return;
            if (StorageController.preferences.get("suppressLoginPrompt")) return;
            this.openOverlay();
        }

        // A device that was logged in last visit but whose session didn't
        // validate this load (expired, revoked from another device) just
        // silently reverted to offline play -- the header icon alone is
        // too easy to miss for a change nobody asked for. Explicit logout
        // doesn't set this flag (see auth.js's logout/forgetLoggedIn), so
        // this only fires for the unexpected case.
        announceSessionExpiredIfNeeded() {
            if (!window.LeftWordleAuth.consumeSessionUnexpectedlyEnded()) return;
            var app = document.querySelector("game-app");
            if (app && typeof app.addToast === "function") {
                app.addToast("Your session ended — you're playing offline on this device now", null, true, true);
            }
        }

        async maybeHandleDeviceLinkLanding() {
            var params = new URLSearchParams(window.location.search);
            var linkToken = params.get("link_token");
            if (!linkToken) return;

            var landing = $("login-link-landing");
            var button = $("login-link-landing-button");
            var statusEl = $("login-link-landing-status");
            var deviceNameInput = $("login-link-landing-device-name-input");
            if (!landing || !button) return;

            landing.classList.remove("hidden");
            var headerContainer = $("header-container");
            if (headerContainer) headerContainer.style.display = "none";
            if (deviceNameInput && !deviceNameInput.value && window.LeftWordleAuth.guessDeviceNickname) {
                deviceNameInput.value = window.LeftWordleAuth.guessDeviceNickname();
            }

            button.addEventListener("click", async function() {
                setStatus(statusEl, "Completing passkey setup...", false);
                try {
                    var nickname = deviceNameInput ? deviceNameInput.value.trim() : "";
                    await window.LeftWordleAuth.registerViaDeviceLink(linkToken, nickname);
                    await window.leftWordleLoginUI.syncAndAnnounce();
                    window.leftWordleLoginUI.resetSuppressedLoginPrompt();
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
                    self.render();
                    self.closeOverlay();
                });
            }

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

            var recoverButton = $("login-recover-button");
            if (recoverButton) recoverButton.addEventListener("click", function() { self.openRecoverModal(); });
            var recoverSend = $("login-recover-send");
            if (recoverSend) recoverSend.addEventListener("click", function() { self.handleRequestRecovery(); });
            var recoverCancel = $("login-recover-cancel");
            if (recoverCancel) recoverCancel.addEventListener("click", function() { self.closeRecoverModal(); });

            var managePasskeysButton = $("login-manage-passkeys-button");
            if (managePasskeysButton) managePasskeysButton.addEventListener("click", function() { self.openPasskeysModal(); });
            var passkeysClose = $("login-passkeys-close");
            if (passkeysClose) passkeysClose.addEventListener("click", function() { self.closePasskeysModal(); });

            this.maybeHandleDeviceLinkLanding();

            var config = window.LEFT_WORDLE_CONFIG || {};
            if (config.passkeyAuthEnabled && window.LeftWordleAuth) {
                window.LeftWordleAuth.ready.then(function() { self.render(); });
            } else {
                this.render();
            }
        }
    }

    function formatPasskeyDate(isoString) {
        var parsed = new Date(isoString);
        if (isNaN(parsed.getTime())) return isoString;
        return parsed.toLocaleDateString();
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
