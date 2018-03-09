"use strict";
(function (Q, $) {

	var Users = Q.plugins.Users;

	Q.onReady.add(function () {
		if (Q.info.isCordova && (window.FCMPlugin || window.PushNotification)) {
			var appId = location.search.queryField('Q.Users.appId');
			if (!Q.isEmpty(appId)) {
				_setToStorage('appId', appId);
			}
		}
		Users.Device.init(function () {
			console.log('Users.Device adapter init: ' + Users.Device.adapter.adapterName);
		});
	}, 'Users.Device');

	/**
	 * @class Users.Device
	 */
	Users.Device = {
		/**
		 * Subscribe to listen for push notifications
		 * if the current environment supports it.
		 * (Web Push, Cordova, etc.)
		 * @method subscribe
		 * @static
		 * @param {Function} callback
		 * @param {Object} options
		 * @param {Boolean} options.userVisibleOnly whether the returned push subscription
		 *   will only be used for messages whose effect is made visible to the user
		 * @param {String} options.applicationServerKey A public key your push server
		 *   will use to send messages to client apps via a push server. This value is
		 *   part of a signing key pair generated by your application server, and usable
		 *   with elliptic curve digital signature (ECDSA), over the P-256 curve.
		 */
		subscribe: function (callback, options) {
			this.getAdapter(function (err, adapter) {
				if (err) {
					if (callback) {
						callback(err);
					} else {
						console.warn(err);
					}
				} else {
					adapter.subscribe(function (err, subscribed) {
						if (callback) {
							callback(err, subscribed);
						} else {
							console.warn(err);
						}
					}, options);
				}
			});
		},

		/**
		 * Unsubscribe to stop handling push notifications
		 * if we were previously subscribed
		 * @method unsubscribe
		 * @static
		 * @param {Function} callback
		 */
		unsubscribe: function (callback) {
			this.getAdapter(function (err, adapter) {
				if (err) {
					if (callback) {
						callback(err);
					} else {
						console.warn(err);
					}
				} else {
					adapter.unsubscribe(function (err) {
						if (callback)
							callback(err);
					});
				}
			});
		},

		/**
		 * Checks whether the user already has a subscription.
		 * @method subscribed
		 * @static
		 * @param {Boolean} callback Whether the user already has a subscription
		 */
		subscribed: function (callback) {
			this.getAdapter(function (err, adapter) {
				if (err) {
					if (callback) {
						callback(err);
					} else {
						console.warn(err);
					}
				} else {
					adapter.subscribed(function (err, subscribed) {
						if (callback) {
							callback(err, subscribed);
						}
					});
				}
			})
		},

		/**
		 * Event occurs when a notification comes in to be processed by the app.
		 * The handlers you add are supposed to process it.
		 * The notification might have brought the app back from the background,
		 * or not. Please see the documentation here:
		 * https://github.com/katzer/cordova-plugin-local-notifications
		 * @event onNotification
		 */
		onNotification: new Q.Event(),

		init: function (callback) {
			if (Q.info.isCordova && window.FCMPlugin) {
				// FCM adapter
				this.adapter = adapterFCM;
			} else if (Q.info.isCordova && window.PushNotification) {
				// PushNotification adapter
				this.adapter = adapterPushNotification;
			} else if ((Q.info.browser.name === 'chrome') || (Q.info.browser.name === 'firefox')) {
				// Chrome and Firefox
				this.adapter = adapterWeb;
			} else if (Q.info.browser.name === 'safari') {
				// TODO implement adapter for Safari Browser
				this.adapter = adapterWeb;
			}
			if (this.adapter) {
				this.adapter.init(callback);
			} else {
				console.info("Users.Device: No suitable adapter for push notifications");
			}
		},

		getAdapter: function (callback) {
			if (!this.adapter) {
				if (callback) {
					callback(new Error('There is no suitable adapter for this type of device'));
				}
				return;
			}
			callback(null, this.adapter);
		},

		adapter: null

	};

	// Adapter for Chrome and Firefox
	var adapterWeb = {

		adapterName: 'Web',

		init: function () {
			this.appConfig = Q.getObject('Q.Users.browserApps.' + Q.info.browser.name + '.' + Q.info.app);
			if (!this.appConfig) {
				console.warn('Unable to init adapter. App config is not defined.');
			}
		},

		subscribe: function (callback, options) {
			var self = this;
			this.getServiceWorkerRegistration(function (err, sw) {
				if (err)
					callback(err);
				else {
					var userVisibleOnly = true;
					if (options && !options.userVisibleOnly) {
						userVisibleOnly = false;
					}
					sw.pushManager.subscribe({
						userVisibleOnly: userVisibleOnly,
						applicationServerKey: _urlB64ToUint8Array(self.appConfig.publicKey)
					}).then(function (subscription) {
						_saveSubscription(subscription, self.appConfig, function(err, res){
							callback(err, res);
						});
					}).catch(function (err) {
						if (Notification.permission === 'denied') {
							console.error('Users.Device: Permission for Notifications was denied');
						} else {
							console.error('Users.Device: Unable to subscribe to push.', err);
						}
						if (callback) {
							callback(err);
						}
					});
				}
			});
		},

		unsubscribe: function (callback) {
			this.getServiceWorkerRegistration(function (err, sw) {
				if (err)
					callback(err);
				else {
					sw.pushManager.getSubscription()
						.then(function (subscription) {
							if (subscription) {
								_deleteSubscription(subscription.endpoint, function (err, res) {
									callback(err, res);
								});
								subscription.unsubscribe();
								console.log('Users.Device: User is unsubscribed.');
							}
						});
				}
			});
		},

		subscribed: function (callback) {
			this.getServiceWorkerRegistration(function (err, sw) {
				if (err)
					callback(err);
				else {
					sw.pushManager.getSubscription()
						.then(function (subscription) {
							callback(null, subscription);
						}).catch(function (err) {
						callback(err);
					});
				}
			});
		},

		getServiceWorkerRegistration: function (callback) {
			var self = this;
			if (this.serviceWorkerRegistration) {
				return callback(null, this.serviceWorkerRegistration);
			}
			_registerServiceWorker.bind(this)(function (err, sw) {
				if (err)
					return callback(err);
				else {
					self.serviceWorkerRegistration = sw;
					return callback(null, sw);
				}
			});
		},

		serviceWorkerRegistration: null,

		appConfig: null

	};

	// Adapter for FCM
	var adapterFCM = {

		adapterName: 'FCM',

		init: function (callback) {
			FCMPlugin.onTokenRefresh(function (token) {
				_registerDevice(token);
			});

			FCMPlugin.onNotification(function (data) {
				// data.wasTapped is true: Notification was received on device tray and tapped by the user.
				// data.wasTapped is false: Notification was received in foreground. Maybe the user needs to be notified.
				Users.Device.onNotification.handle(data);
			});

			if (callback)
				callback();
		},

		subscribe: function (callback) {
			FCMPlugin.getToken(function (token) {
				_registerDevice(token, callback);
			});
		},

		unsubscribe: function (callback) {
			var deviceId = _getFromStorage('deviceId');
			_removeFromStorage('deviceId');
			_deleteSubscription(deviceId, function (err, res) {
				callback(err, res);
			});
		},

		subscribed: function (callback) {
			if (_getFromStorage('deviceId')) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		}

	};

	// Adapter for PushNotification
	var adapterPushNotification = {

		adapterName: 'PushNotification',

		init: function (callback) {
			if (_getFromStorage('deviceId')) {
				_pushNotificationInit();
			}
			if (callback)
				callback();
		},

		subscribe: function (callback) {
			_pushNotificationInit();
			if (callback)
				callback();
		},

		unsubscribe: function (callback) {
			var deviceId = _getFromStorage('deviceId');
			_removeFromStorage('deviceId');
			_deleteSubscription(deviceId, function (err, res) {
				callback(err, res);
			});
		},

		subscribed: function (callback) {
			if (_getFromStorage('deviceId')) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		}

	};

	function _registerServiceWorker(callback) {
		if (Q.info.url.substr(0, 8) !== 'https://') {
			if (callback)
				callback(new Error("Push notifications require HTTPS"));
			return;
		}
		if (!(('serviceWorker' in navigator) && ('PushManager' in window))) {
			if (callback)
				callback(new Error("Push messaging is not supported"));
			return;
		}
		navigator.serviceWorker.register('/Q/plugins/Users/js/sw.js')
			.then(function (swReg) {
				navigator.serviceWorker.addEventListener('message', function (event) {
					Users.Device.onNotification.handle(event.data);
				});
				console.log('Service Worker is registered.');
				if (callback)
					callback(null, swReg);
			})
			.catch(function (error) {
				callback(error);
				console.error('Users.Device: Service Worker Error', error);
			});
	}

	function _registerDevice(deviceId, callback) {
		if (!deviceId || !Q.Users.loggedInUser) {
			return callback(new Error('Error while registering device. User must be logged in and deviceId must be set.'))
		}
		var appId = _getFromStorage('appId');
		if (!appId) {
			return callback(new Error('Error while registering device. AppId must be must be set.'));
		}
		Q.req('Users/device', function (err, response) {
			if (!err) {
				_setToStorage('deviceId', deviceId);
				Q.handle(Users.onDevice, [response.data]);
			}
			callback && callback(err, response);
		}, {
			method: 'post',
			fields: {
				appId: appId,
				deviceId: deviceId
			}
		});
	}

	function _urlB64ToUint8Array(base64String) {
		var padding = '='.repeat((4 - base64String.length % 4) % 4);
		var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
		var rawData = window.atob(base64);
		var outputArray = new Uint8Array(rawData.length);
		for (var i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	function _saveSubscription(subscription, appConfig, callback) {
		if (!subscription) {
			return callback(new Error('No subscription data'));
		}
		subscription = JSON.parse(JSON.stringify(subscription));
		Q.req('Users/device', function (err, response) {
			if (!err) {
				Q.handle(Users.onDevice, [response.data]);
			}
			callback(err, response);
		}, {
			method: 'post',
			fields: {
				deviceId: subscription.endpoint,
				auth: subscription.keys.auth,
				p256dh: subscription.keys.p256dh,
				appId: appConfig.appId
			}
		});
	}

	function _deleteSubscription(deviceId, callback) {
		if (!deviceId) {
			return;
		}
		Q.req('Users/device', function (err, response) {
			if (callback) {
				callback(err, response);
			}
		}, {
			method: 'delete',
			fields: {
				deviceId: deviceId
			}
		});
	}

	function _pushNotificationInit() {
		var push = PushNotification.init({
			android: {},
			browser: {
				pushServiceURL: 'http://push.api.phonegap.com/v1/push'
			},
			ios: {
				alert: true,
				badge: true,
				sound: true
			},
			windows: {}
		});

		push.on('registration', function (data) {
			_setToStorage('deviceId', data.registrationId);
			if (Q.Users.loggedInUser) {
				_registerDevice(data.registrationId);
			}
		});

		push.on('notification', function (data) {
			Users.Device.onNotification.handle(data);
		});

		push.on('error', function (e) {
			console.warn("Users.Device: ERROR", e);
		});

		Users.logout.options.onSuccess.set(function () {
			PushNotification.setApplicationBadgeNumber(0);
		}, 'Users.PushNotifications');

	}

	function _getFromStorage(type) {
		return localStorage.getItem("Q\tUsers.Device." + type);
	}

	function _setToStorage(type, value) {
		localStorage.setItem("Q\tUsers.Device." + type, value);
	}

	function _removeFromStorage(type) {
		localStorage.removeItem("Q\tUsers.Device." + type);
	}

})(Q, jQuery);
