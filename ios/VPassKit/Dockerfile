# Linux toolchain for VPassKit's tests (`make test-ios-kit`): Swift plus the system libsodium.
FROM swift:6.2-noble
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libsodium-dev pkg-config \
	&& rm -rf /var/lib/apt/lists/*
